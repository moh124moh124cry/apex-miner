import { NextResponse } from 'next/server';
import { supabaseAdmin } from '../../../../lib/supabase-admin';
import { validateTelegramInitData } from '../../../../lib/telegram-auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const CLAIM_COOLDOWN_SECONDS = 600;
const ACTIVE_FRIEND_WINDOW_MS = 24 * 60 * 60 * 1000;

function jsonResponse(body, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: {
      'Cache-Control': 'no-store',
    },
  });
}

export async function POST(request) {
  try {
    const body = await request.json();
    const initData = body?.initData;

    if (!initData || typeof initData !== 'string') {
      return jsonResponse(
        { error: 'Telegram init data is required' },
        400
      );
    }

    if (initData.length > 8192) {
      return jsonResponse(
        { error: 'Invalid Telegram init data' },
        400
      );
    }

    const telegram = validateTelegramInitData(initData);
    const telegramId = String(telegram.user.id);

    const { data: user, error: userError } = await supabaseAdmin
      .from('users')
      .select('balance, mining_rate, last_claim')
      .eq('telegram_id', telegramId)
      .maybeSingle();

    if (userError) {
      console.error('Mining claim user read error:', userError.code);
      return jsonResponse({ error: 'Database error' }, 500);
    }

    if (!user) {
      return jsonResponse({ error: 'User not found' }, 404);
    }

    const now = new Date();
    const nowMs = now.getTime();

    const lastClaimMs = user.last_claim
      ? new Date(user.last_claim).getTime()
      : nowMs;

    if (!Number.isFinite(lastClaimMs)) {
      console.error('Mining claim invalid last_claim:', telegramId);
      return jsonResponse({ error: 'Invalid mining state' }, 500);
    }

    const elapsedSeconds = Math.max(
      0,
      (nowMs - lastClaimMs) / 1000
    );

    if (elapsedSeconds < CLAIM_COOLDOWN_SECONDS) {
      const retryAfter = Math.ceil(
        CLAIM_COOLDOWN_SECONDS - elapsedSeconds
      );

      return jsonResponse(
        {
          error: 'Claim cooldown active',
          retryAfter,
        },
        429
      );
    }

    const baseRate = Number(user.mining_rate ?? 0.00025);
    const currentBalance = Number(user.balance ?? 0);

    if (
      !Number.isFinite(baseRate) ||
      baseRate < 0 ||
      !Number.isFinite(currentBalance) ||
      currentBalance < 0
    ) {
      console.error('Mining claim invalid numeric state:', telegramId);
      return jsonResponse({ error: 'Invalid mining state' }, 500);
    }

    const activeSince = new Date(
      nowMs - ACTIVE_FRIEND_WINDOW_MS
    ).toISOString();

    const {
      count: activeFriendsCount,
      error: friendsError,
    } = await supabaseAdmin
      .from('users')
      .select('telegram_id', {
        count: 'exact',
        head: true,
      })
      .eq('referred_by', telegramId)
      .gte('last_claim', activeSince);

    if (friendsError) {
      console.error(
        'Mining claim active friends error:',
        friendsError.code
      );
      return jsonResponse({ error: 'Database error' }, 500);
    }

    const activeFriends = Number(activeFriendsCount || 0);

    const friendsBonusRate =
      activeFriends * (baseRate * 0.05);

    const totalRate = baseRate + friendsBonusRate;
    const claimedAmount = elapsedSeconds * totalRate;
    const newBalance = currentBalance + claimedAmount;
    const claimedAt = now.toISOString();

    if (
      !Number.isFinite(totalRate) ||
      !Number.isFinite(claimedAmount) ||
      claimedAmount < 0 ||
      !Number.isFinite(newBalance)
    ) {
      console.error('Mining claim calculation error:', telegramId);
      return jsonResponse({ error: 'Invalid mining calculation' }, 500);
    }

    const { data: updatedUser, error: updateError } =
      await supabaseAdmin
        .from('users')
        .update({
          balance: newBalance,
          last_claim: claimedAt,
        })
        .eq('telegram_id', telegramId)
        .eq('last_claim', user.last_claim)
        .select('balance, last_claim')
        .maybeSingle();

    if (updateError) {
      console.error('Mining claim update error:', updateError.code);
      return jsonResponse({ error: 'Database error' }, 500);
    }

    if (!updatedUser) {
      return jsonResponse(
        {
          error: 'Claim already processed',
          retryAfter: CLAIM_COOLDOWN_SECONDS,
        },
        409
      );
    }

    return jsonResponse({
      success: true,
      balance: Number(updatedUser.balance),
      claimed: claimedAmount,
      miningRate: totalRate,
      baseMiningRate: baseRate,
      activeFriends,
      lastClaim: updatedUser.last_claim,
      cooldown: CLAIM_COOLDOWN_SECONDS,
    });
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : 'Unknown error';

    const isAuthError =
      message.includes('Telegram') ||
      message.includes('BOT_TOKEN') ||
      message.includes('Expired');

    if (!isAuthError) {
      console.error('Mining claim API error:', message);
    }

    return jsonResponse(
      {
        error: isAuthError
          ? 'Invalid Telegram authentication'
          : 'Internal server error',
      },
      isAuthError ? 401 : 500
    );
  }
}

