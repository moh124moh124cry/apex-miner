import { NextResponse } from 'next/server';
import { supabaseAdmin } from '../../../lib/supabase-admin';
import { validateTelegramInitData } from '../../../lib/telegram-auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MINIMUM_BALANCE = 20000;
const FIXED_AMOUNT = 10000;
const DAILY_REWARD = 1000;

function json(data, status = 200) {
  return NextResponse.json(data, {
    status,
    headers: { 'Cache-Control': 'no-store' },
  });
}

function toClientStatus(cycle, balance, serverNow) {
  const eligible = balance >= MINIMUM_BALANCE;
  const status = cycle?.status === 'active'
    ? 'active'
    : cycle?.status === 'claimed' ? 'claimed' : 'idle';
  return {
    balance,
    eligible,
    status,
    startedAt: cycle?.started_at ?? null,
    endsAt: cycle?.ends_at ?? null,
    cycleNumber: Number(cycle?.cycle_number || 0),
    serverNow,
    fixedAmount: FIXED_AMOUNT,
    minimumBalance: MINIMUM_BALANCE,
    dailyReward: DAILY_REWARD,
  };
}

// All staking actions use authenticated Telegram initData; never accept
// a user ID or an amount from the client. Only the RPC mutates balances.
export async function POST(request) {
  try {
    const body = await request.json();
    const { initData, action } = body ?? {};
    if (typeof initData !== 'string' || !initData || initData.length > 8192) {
      return json({ error: 'Invalid Telegram authentication' }, 401);
    }
    if (!['status', 'activate', 'claim'].includes(action)) {
      return json({ error: 'Invalid staking action' }, 400);
    }

    const telegram = validateTelegramInitData(initData);
    const telegramId = String(telegram.user.id);

    if (action === 'status') {
      const { data: user, error: userError } = await supabaseAdmin
        .from('users')
        .select('balance')
        .eq('telegram_id', telegramId)
        .maybeSingle();
      if (userError) throw userError;
      if (!user) return json({ error: 'User not found' }, 404);

      const { data: cycle, error: cycleError } = await supabaseAdmin
        .from('apxn_staking_cycles')
        .select('status,started_at,ends_at,cycle_number')
        .eq('telegram_id', telegramId)
        .maybeSingle();
      if (cycleError) throw cycleError;

      return json(toClientStatus(cycle, Number(user.balance || 0), new Date().toISOString()));
    }

    // SQL locks the user row, verifies eligibility/cooldown, prevents
    // concurrent claims, and writes the +1,000 points atomically.
    const { data, error } = await supabaseAdmin.rpc('apxn_staking_action', {
      p_telegram_id: telegramId,
      p_action: action,
    });
    if (error) throw error;
    const result = Array.isArray(data) ? data[0] : data;
    if (!result) throw new Error('Missing staking RPC result');

    const payload = {
      ...toClientStatus({
        status: result.status,
        started_at: result.started_at,
        ends_at: result.ends_at,
        cycle_number: result.cycle_number,
      }, Number(result.balance || 0), new Date().toISOString()),
      success: Boolean(result.success),
      reward: Number(result.reward || 0),
      retryAfter: Number(result.retry_after || 0),
      errorCode: result.error_code ?? null,
    };

    if (!result.success) {
      const statuses = {
        NOT_ELIGIBLE: 403,
        USER_NOT_FOUND: 404,
        TOO_EARLY: 409,
        CYCLE_ACTIVE: 409,
        NO_ACTIVE_CYCLE: 409,
        INVALID_ACTION: 400,
      };
      return json(payload, statuses[result.error_code] ?? 400);
    }
    return json(payload);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    if (/Telegram|BOT_TOKEN|Expired|signature|auth_date/i.test(message)) {
      return json({ error: 'Invalid or expired Telegram authentication' }, 401);
    }
    console.error('Staking API error:', error?.code || message);
    return json({ error: 'Staking service is temporarily unavailable' }, 503);
  }
}

