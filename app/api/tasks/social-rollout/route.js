/**
 * APXN — Safe Social Tasks Rollout Gateway
 *
 * NEW FILE — never replaces the active social-task endpoint.
 * Repository: moh124moh124cry/apex-miner
 * Branch: cloudflare-migration
 * Save this COMPLETE file at:
 *   app/api/tasks/social-rollout/route.js
 *
 * New endpoint:
 *   POST /api/tasks/social-rollout
 *
 * Inert by default: the current application still calls /api/tasks/social.
 * Even when this gateway is called, the default handler is the original V1.
 *
 * Optional Cloudflare Worker environment variables:
 *   APXN_SOCIAL_ROLLOUT_ENABLED=true
 *   APXN_SOCIAL_V2_ROLLOUT_PERCENT=5
 *
 * Without BOTH a true enabled flag and a valid percentage > 0, 100%
 * of requests use the original V1 handler.
 *
 * The cohort is chosen deterministically from a verified Telegram ID.
 * It is not chosen using an untrusted client-supplied user ID.
 *
 * SAFETY:
 * - No database schema or RPC changes.
 * - No caching of user balances, rewards, mining or wallet state.
 * - Existing handlers verify Telegram input and award points as before.
 * - The original /api/tasks/social and new /api/tasks/social-v2
 *   remain unchanged and can continue to be used independently.
 * - Never automatically replay/retry a request from V2 to V1:
 *   the award may already have committed before an error was returned.
 * - Invalid Telegram data goes to the existing V1 validator, preserving
 *   the existing error handling.
 * - To instantly disable V2: set APXN_SOCIAL_ROLLOUT_ENABLED=false
 *   (or APXN_SOCIAL_V2_ROLLOUT_PERCENT=0) in Cloudflare Worker settings.
 *
 * To use this gateway with the application later, change ONLY the
 * endpoint URL in the existing client from /api/tasks/social to
 * /api/tasks/social-rollout. This file alone does not make that change.
 */

import { validateTelegramInitData } from '../../../../lib/telegram-auth';
import { POST as legacySocialPost } from '../social/route';
import { POST as optimizedSocialPost } from '../social-v2/route';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function getV2RolloutPercent() {
  // Explicit opt-in. Defaults to original production handler.
  if (process.env.APXN_SOCIAL_ROLLOUT_ENABLED !== 'true') {
    return 0;
  }

  const raw = process.env.APXN_SOCIAL_V2_ROLLOUT_PERCENT;
  if (typeof raw !== 'string' || !/^\d{1,3}$/.test(raw.trim())) {
    return 0;
  }

  const parsed = Number(raw.trim());
  if (!Number.isInteger(parsed) || parsed < 0 || parsed > 100) {
    return 0;
  }

  return parsed;
}

// Portable deterministic FNV-1a bucket; stable across isolated Workers.
// This is a cohort assignment, not a security or identity proof.
function getUserRolloutBucket(verifiedTelegramId) {
  let hash = 2166136261;
  for (let i = 0; i < verifiedTelegramId.length; i += 1) {
    hash ^= verifiedTelegramId.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0) % 100;
}

export async function POST(request) {
  const v2Percent = getV2RolloutPercent();

  // Safe default: no extra body parsing and no change in behavior.
  if (v2Percent === 0) {
    return legacySocialPost(request);
  }

  let initData;
  try {
    // Clone leaves the original Request body intact for the handler.
    const payload = await request.clone().json();
    initData = payload?.initData;
  } catch {
    return legacySocialPost(request);
  }

  if (
    typeof initData !== 'string' ||
    initData.length === 0 ||
    initData.length > 8192
  ) {
    return legacySocialPost(request);
  }

  let telegramId;
  try {
    const telegram = validateTelegramInitData(initData);
    if (telegram?.user?.id === undefined || telegram.user.id === null) {
      return legacySocialPost(request);
    }
    telegramId = String(telegram.user.id);
  } catch {
    // The original route responds using its existing auth error format.
    return legacySocialPost(request);
  }

  const useV2 = getUserRolloutBucket(telegramId) < v2Percent;

  // Do NOT try the other handler automatically if this one fails.
  // An in-flight reward may already have been committed to PostgreSQL.
  return useV2
    ? optimizedSocialPost(request)
    : legacySocialPost(request);
}

