// APEX NETWORK (APXN) — Daily Article Task API
// GITHUB PATH: app/api/tasks/article/route.js
// GITHUB BRANCH: cloudflare-migration
//
// Create this as a NEW file named route.js in GitHub; do not upload it
// with a .txt extension. No edits to app/page.js or the YouTube route.
//
// Task: Visit Today's APXN Article (+50 APXN Points, once per UTC day).
// Cloudflare runtime variable: DAILY_APXN_ARTICLE_URL
// Database requirements (provided in a separate next step):
//   public.users.article_last_claim_date (date)
//   public.apex_claim_article_task(p_telegram_id bigint)
// The RPC must atomically check the UTC day, award exactly 50 points,
// and reject duplicate claims with error_code = 'ALREADY_CLAIMED'.
//
// Opening a URL and confirming a task do not prove full article reading.
// Daily eligibility is enforced by the server/database, not the UI.

import { NextResponse } from 'next/server';
import { env } from 'cloudflare:workers';
import { supabaseAdmin } from '../../../../lib/supabase-admin';
import { validateTelegramInitData } from '../../../../lib/telegram-auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function validArticleUrl(raw) {
  if (typeof raw !== 'string' || !raw.trim()) return '';
  try {
    const url = new URL(raw.trim());
    if (
      url.protocol !== 'https:' ||
      !['apxn.network', 'www.apxn.network'].includes(url.hostname.toLowerCase()) ||
      url.username ||
      url.password
    ) {
      return '';
    }
    return url.href;
  } catch {
    return '';
  }
}

function articleUrlFromCloudflare() {
  return validArticleUrl(env.DAILY_APXN_ARTICLE_URL);
}

function utcDay() {
  return new Date().toISOString().slice(0, 10);
}

function reply(body, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: { 'Cache-Control': 'no-store' },
  });
}

export async function POST(request) {
  try {
    const body = await request.json();
    const initData = body?.initData;
    const action = body?.action;

    if (typeof initData !== 'string' || !initData) {
      return reply({ error: 'Telegram init data is required' }, 400);
    }
    if (action !== 'status' && action !== 'claim') {
      return reply({ error: 'Invalid action' }, 400);
    }

    // The existing helper verifies Telegram's signed Mini App initData.
    const telegram = validateTelegramInitData(initData);
    const telegramId = String(telegram.user.id);
    const articleUrl = articleUrlFromCloudflare();

    if (action === 'status') {
      const { data: user, error } = await supabaseAdmin
        .from('users')
        .select('article_last_claim_date')
        .eq('telegram_id', telegramId)
        .maybeSingle();

      if (error) {
        console.error('APXN article task status DB error:', error.code);
        return reply({ error: 'Database error' }, 500);
      }
      if (!user) return reply({ error: 'User not found' }, 404);

      const today = utcDay();
      return reply({
        success: true,
        today,
        articleUrl,
        articleDone: user.article_last_claim_date === today,
        reward: 50,
      });
    }

    // Claiming is disabled until a real official APXN article is configured.
    if (!articleUrl) {
      return reply({ error: 'Today’s APXN article is not configured' }, 503);
    }

    // All changes to points and claim dates must be performed atomically
    // in the forthcoming Supabase RPC; never credit the client directly.
    const { data, error } = await supabaseAdmin.rpc(
      'apex_claim_article_task',
      { p_telegram_id: telegramId }
    );

    if (error) {
      console.error('APXN article claim RPC error:', error.code);
      return reply({ error: 'Database error' }, 500);
    }

    const result = Array.isArray(data) ? data[0] : data;
    if (!result) return reply({ error: 'Invalid claim response' }, 500);

    if (!result.success) {
      const already = result.error_code === 'ALREADY_CLAIMED';
      const missing = result.error_code === 'USER_NOT_FOUND';
      return reply({
        success: false,
        completed: already,
        error: already
          ? 'Article task already claimed today'
          : missing
            ? 'User not found'
            : 'Article task could not be completed',
        balance: Number(result.balance ?? 0),
      }, already ? 409 : missing ? 404 : 400);
    }

    return reply({
      success: true,
      completed: true,
      reward: Number(result.reward ?? 50),
      balance: Number(result.balance ?? 0),
      today: utcDay(),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : '';
    const invalidAuth = /Telegram|Expired|BOT_TOKEN|signature|auth/i.test(message);
    if (!invalidAuth) console.error('APXN article task request error:', message);
    return reply(
      { error: invalidAuth ? 'Invalid Telegram authentication' : 'Internal server error' },
      invalidAuth ? 401 : 500
    );
  }
}

