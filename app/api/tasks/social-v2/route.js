/**
 * Apex Network — Social Tasks V2 (safe, opt-in route)
 * Repository: moh124moh124cry/apex-miner
 * Branch: cloudflare-migration
 * NEW FILE PATH: app/api/tasks/social-v2/route.js
 *
 * This is a COMPLETE route. It does not replace the existing
 * app/api/tasks/social/route.js, and it has no effect until the
 * client explicitly calls /api/tasks/social-v2.
 *
 * Based on the existing social-task route at commit
 * 45659988fa39b1ab97bcbdae81e23100828ef2a9 (Nov 22, 2026).
 *
 * SAFETY:
 * - Validates Telegram initData on every request (no user-supplied IDs).
 * - Never caches balance, incomplete status, or membership status.
 * - Telegram group/channel membership is still checked BEFORE an award.
 * - apex_claim_social_task (Postgres RPC) remains the sole authority
 *   for points, idempotency and the returned balance.
 * - Only positive, already-completed, irreversible one-time task flags
 *   can be cached (up to 6 hours) to avoid repeated Supabase reads.
 * - Cloudflare Cache API is used only if supported. Otherwise the route
 *   works with bounded, per-isolate in-memory positive-result caching.
 * - An optional env APXN_SOCIAL_TASK_CACHE_ENABLED=false disables both
 *   positive caches and always retains the database verification.
 * - Do NOT use this cache if administrators routinely reset social-task
 *   completion flags. Set the env flag to false first if resetting.
 *
 * Exact response contracts used by app/page.js are preserved:
 * success -> { success, task, reward, balance, completed }
 * already claimed -> HTTP 409, { error, completed: true }
 */

import { NextResponse } from 'next/server';
import { supabaseAdmin } from '../../../../lib/supabase-admin';
import { validateTelegramInitData } from '../../../../lib/telegram-auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const ALLOWED_TASKS = new Set(['channel', 'group', 'twitter']);
const TELEGRAM_TASK_CHATS = {
  channel: '@ApexMiner_Official',
  group: '@ApexMinerGroup',
};

const CACHE_SECONDS = 6 * 60 * 60;
const IN_FLIGHT_SECONDS = 30;
const MAX_LOCAL_ENTRIES = 5000;
const CACHE_ENABLED = process.env.APXN_SOCIAL_TASK_CACHE_ENABLED !== 'false';

const localGate = globalThis.__apxnSocialTasksV2Gate || new Map();
if (!globalThis.__apxnSocialTasksV2Gate) {
  globalThis.__apxnSocialTasksV2Gate = localGate;
}

function reply(body, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: { 'Cache-Control': 'no-store' },
  });
}

function cacheKeyForLocal(telegramId, task) {
  return JSON.stringify([telegramId, task]);
}

function lookupLocal(key) {
  const entry = localGate.get(key);
  if (!entry) return null;
  if (entry.expiresAt <= Date.now()) {
    localGate.delete(key);
    return null;
  }
  return entry;
}

function storeLocal(key, status, seconds) {
  localGate.delete(key);
  localGate.set(key, {
    status,
    expiresAt: Date.now() + seconds * 1000,
  });
  while (localGate.size > MAX_LOCAL_ENTRIES) {
    const oldest = localGate.keys().next().value;
    if (oldest === undefined) break;
    localGate.delete(oldest);
  }
}

function clearPending(key) {
  if (lookupLocal(key)?.status === 'pending') {
    localGate.delete(key);
  }
}

// The Cache API is optional in Cloudflare/OpenNext nodejs compatibility mode.
// Cache keys contain a SHA-256 digest, not a raw Telegram identifier.
async function completionCacheRequest(telegramId, task, requestUrl) {
  if (!CACHE_ENABLED || !globalThis.caches?.default || !globalThis.crypto?.subtle) {
    return null;
  }
  try {
    const raw = new TextEncoder().encode(`apxn-social-completed-v2:${telegramId}:${task}`);
    const digest = await crypto.subtle.digest('SHA-256', raw);
    const hex = Array.from(new Uint8Array(digest))
      .map((n) => n.toString(16).padStart(2, '0')).join('');
    // Cloudflare Cache API keys should use the same hostname as this Worker.
    const url = new URL(`/__apxn_internal_cache/social-completed-v2/${hex}`, requestUrl);
    return new Request(url.toString(), { method: 'GET' });
  } catch {
    return null;
  }
}

async function isCompletedCached(telegramId, task, requestUrl) {
  if (!CACHE_ENABLED) return false;
  const key = cacheKeyForLocal(telegramId, task);
  if (lookupLocal(key)?.status === 'completed') return true;
  const request = await completionCacheRequest(telegramId, task, requestUrl);
  if (!request) return false;
  try {
    const result = await globalThis.caches.default.match(request);
    if (result?.ok && (await result.text()) === 'completed') {
      storeLocal(key, 'completed', CACHE_SECONDS);
      return true;
    }
  } catch {
    // Unsupported cache API: do the original Supabase verification.
  }
  return false;
}

async function saveCompleted(telegramId, task, requestUrl) {
  if (!CACHE_ENABLED) return;
  const key = cacheKeyForLocal(telegramId, task);
  storeLocal(key, 'completed', CACHE_SECONDS);
  const request = await completionCacheRequest(telegramId, task, requestUrl);
  if (!request) return;
  try {
    await globalThis.caches.default.put(
      request,
      new Response('completed', {
        status: 200,
        headers: {
          'Content-Type': 'text/plain',
          'Cache-Control': `public, max-age=${CACHE_SECONDS}`,
        },
      })
    );
  } catch {
    // Cache failure must never invalidate an already committed SQL reward.
  }
}

function wasCompleted(user, task) {
  if (task === 'channel') return Boolean(user.channel_joined);
  if (task === 'group') return Boolean(user.group_joined);
  return Boolean(user.twitter_joined);
}

function isActiveMember(member) {
  if (!member?.status) return false;
  if (['creator', 'administrator', 'member'].includes(member.status)) return true;
  return member.status === 'restricted' && member.is_member === true;
}

async function verifyTelegramMembership(task, telegramNumericId) {
  const chatId = TELEGRAM_TASK_CHATS[task];
  if (!chatId) return false;
  const token = process.env.BOT_TOKEN;
  if (!token) throw new Error('Missing BOT_TOKEN');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  try {
    const response = await fetch(`https://api.telegram.org/bot${token}/getChatMember`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, user_id: telegramNumericId }),
      cache: 'no-store',
      signal: controller.signal,
    });
    const data = await response.json().catch(() => null);
    if (!response.ok || !data?.ok || !data?.result) {
      throw new Error('Telegram membership verification failed');
    }
    return isActiveMember(data.result);
  } finally {
    clearTimeout(timer);
  }
}

export async function POST(request) {
  let localKey = null;
  try {
    const body = await request.json();
    const initData = body?.initData;
    const task = body?.task;

    if (typeof initData !== 'string' || !initData || initData.length > 8192) {
      return reply({ error: 'Telegram init data is required' }, 400);
    }
    if (!ALLOWED_TASKS.has(task)) {
      return reply({ error: 'Invalid task' }, 400);
    }

    const telegram = validateTelegramInitData(initData);
    const telegramId = String(telegram.user.id);
    localKey = cacheKeyForLocal(telegramId, task);

    if (CACHE_ENABLED && lookupLocal(localKey)?.status === 'completed') {
      return reply({ error: 'Task already claimed', completed: true }, 409);
    }

    if (lookupLocal(localKey)?.status === 'pending') {
      return reply({
        error: 'Task request already in progress', retryAfter: 1, completed: false,
      }, 429);
    }

    storeLocal(localKey, 'pending', IN_FLIGHT_SECONDS);

    // Read the positive completion marker first. A cache miss is NEVER
    // interpreted as proof that the task is incomplete.
    if (await isCompletedCached(telegramId, task, request.url)) {
      return reply({ error: 'Task already claimed', completed: true }, 409);
    }

    // Authoritative read of current completion flags; no balance selected.
    const { data: user, error: userError } = await supabaseAdmin
      .from('users')
      .select('channel_joined,group_joined,twitter_joined')
      .eq('telegram_id', telegramId)
      .maybeSingle();

    if (userError) {
      console.error('Social V2 pre-check error:', userError.code);
      return reply({ error: 'Database error' }, 500);
    }
    if (!user) return reply({ error: 'User not found' }, 404);
    if (wasCompleted(user, task)) {
      await saveCompleted(telegramId, task, request.url);
      return reply({ error: 'Task already claimed', completed: true }, 409);
    }

    // Exactly as in V1: channel/group require current Telegram membership.
    if (task === 'channel' || task === 'group') {
      let member = false;
      try {
        member = await verifyTelegramMembership(task, telegram.user.id);
      } catch {
        return reply({
          error: 'Unable to verify Telegram membership', completed: false,
        }, 503);
      }
      if (!member) {
        return reply({
          error: task === 'channel'
            ? 'Please join the official Telegram channel first'
            : 'Please join the official Telegram group first',
          completed: false,
        }, 403);
      }
    }

    // All rewards, duplicate prevention, and balances remain authoritative
    // in the existing atomic Postgres function; do not modify the RPC.
    const { data, error } = await supabaseAdmin.rpc('apex_claim_social_task', {
      p_telegram_id: telegramId,
      p_task: task,
    });
    if (error) {
      console.error('Social V2 claim RPC error:', error.code);
      return reply({ error: 'Database error' }, 500);
    }

    const result = Array.isArray(data) ? data[0] : data;
    if (!result) return reply({ error: 'Invalid task result' }, 500);

    if (!result.success) {
      if (result.error_code === 'ALREADY_CLAIMED') {
        await saveCompleted(telegramId, task, request.url);
        return reply({
          error: 'Task already claimed',
          balance: Number(result.balance || 0), completed: true,
        }, 409);
      }
      if (result.error_code === 'USER_NOT_FOUND') {
        return reply({ error: 'User not found' }, 404);
      }
      if (result.error_code === 'INVALID_TASK') {
        return reply({ error: 'Invalid task' }, 400);
      }
      return reply({ error: 'Task failed' }, 400);
    }

    // Successful SQL award is already committed. Positive cache only.
    await saveCompleted(telegramId, task, request.url);
    return reply({
      success: true,
      task,
      reward: Number(result.reward || 0),
      balance: Number(result.balance || 0),
      completed: Boolean(result.task_completed),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    const isAuthError = /Telegram|BOT_TOKEN|Expired|signature|auth_date/i.test(message);
    if (!isAuthError) console.error('Social V2 API error:', error?.code || message);
    return reply({
      error: isAuthError ? 'Invalid Telegram authentication' : 'Internal server error',
    }, isAuthError ? 401 : 500);
  } finally {
    if (localKey) clearPending(localKey);
  }
}

