import { NextResponse } from 'next/server';
import { supabaseAdmin } from '../../../lib/supabase-admin';
import { validateTelegramInitData } from '../../../lib/telegram-auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// =====================================================
// Lightweight per-instance Daily Check-In gate
// =====================================================
//
// This is only a performance optimization.
//
// Vercel may run multiple server instances, so this map
// is NOT a security boundary.
//
// Supabase apex_daily_checkin remains the final authority
// for:
// - Daily reward
// - Balance
// - Streak
// - Duplicate prevention
// - Atomic row locking
//
// IMPORTANT:
// The local gate never stores or returns balance.
// Balance can change through mining/tasks after check-in,
// so only Supabase responses may synchronize balance.
// =====================================================

const MAX_GATE_ENTRIES = 5000;

const dailyCheckinGate =
  globalThis.__apexDailyCheckinGate ||
  new Map();

if (!globalThis.__apexDailyCheckinGate) {
  globalThis.__apexDailyCheckinGate =
    dailyCheckinGate;
}

// =====================================================
// UTC helpers
// =====================================================

function getUtcDayKey(
  date = new Date()
) {
  return date
    .toISOString()
    .slice(0, 10);
}

function setGateEntry(
  telegramId,
  entry
) {
  // Refresh insertion order.
  dailyCheckinGate.delete(
    telegramId
  );

  dailyCheckinGate.set(
    telegramId,
    entry
  );

  // Keep memory usage bounded.
  while (
    dailyCheckinGate.size >
    MAX_GATE_ENTRIES
  ) {
    const oldestKey =
      dailyCheckinGate
        .keys()
        .next()
        .value;

    if (
      oldestKey === undefined
    ) {
      break;
    }

    dailyCheckinGate.delete(
      oldestKey
    );
  }
}

function removeGateEntry(
  telegramId
) {
  dailyCheckinGate.delete(
    telegramId
  );
}

function getValidGateEntry(
  telegramId
) {
  const entry =
    dailyCheckinGate.get(
      telegramId
    );

  if (!entry) {
    return null;
  }

  const today =
    getUtcDayKey();

  // Yesterday's gate must never block today's reward.
  if (
    entry.dayKey &&
    entry.dayKey !== today
  ) {
    removeGateEntry(
      telegramId
    );

    return null;
  }

  return entry;
}

// =====================================================
// Response helper
// =====================================================

function response(
  body,
  status = 200
) {
  return NextResponse.json(
    body,
    {
      status,
      headers: {
        'Cache-Control':
          'no-store',
      },
    }
  );
}

// =====================================================
// Daily Check-In
// =====================================================

export async function POST(
  request
) {
  let gatedTelegramId = null;

  try {
    const body =
      await request.json();

    const initData =
      body?.initData;

    if (
      !initData ||
      typeof initData !== 'string'
    ) {
      return response(
        {
          error:
            'Telegram init data is required',
        },
        400
      );
    }

    // Verify the real Telegram Mini App user.
    const telegram =
      validateTelegramInitData(
        initData
      );

    const telegramId =
      String(
        telegram.user.id
      );

    gatedTelegramId =
      telegramId;

    const today =
      getUtcDayKey();

    const existingGate =
      getValidGateEntry(
        telegramId
      );

    // =================================================
    // 1. Supabase already confirmed that this user
    //    completed today's check-in.
    //
    //    Stop here without touching Supabase again.
    //
    //    IMPORTANT:
    //    Do NOT return balance from local memory.
    //    The user's balance may have changed since the
    //    original check-in because of mining or tasks.
    // =================================================

    if (
      existingGate?.completed ===
      true
    ) {
      return response(
        {
          error:
            'Daily check-in already claimed',

          checkinStreak:
            Number(
              existingGate
                .checkinStreak ||
              0
            ),

          lastCheckinDate:
            existingGate
              .lastCheckinDate ||
            null,
        },
        409
      );
    }

    // =================================================
    // 2. Another request for the same user is already
    //    reaching Supabase on this Vercel instance.
    //
    //    Do not send a duplicate concurrent RPC.
    // =================================================

    if (
      existingGate?.inFlight ===
      true
    ) {
      return response(
        {
          error:
            'Check-in request already in progress',

          retryAfter: 1,
        },
        429
      );
    }

    // =================================================
    // Mark this user as in-flight before calling
    // Supabase.
    // =================================================

    setGateEntry(
      telegramId,
      {
        dayKey: today,
        inFlight: true,
        completed: false,
        checkinStreak: null,
        lastCheckinDate: null,
      }
    );

    // =================================================
    // One authoritative Supabase RPC.
    // =================================================

    const {
      data,
      error,
    } =
      await supabaseAdmin.rpc(
        'apex_daily_checkin',
        {
          p_telegram_id:
            telegramId,
        }
      );

    if (error) {
      // Never keep a legitimate user blocked after an
      // unexpected database error.
      removeGateEntry(
        telegramId
      );

      console.error(
        'Check-in RPC error:',
        error.code
      );

      return response(
        {
          error:
            'Database error',
        },
        500
      );
    }

    const result =
      Array.isArray(data)
        ? data[0]
        : data;

    if (!result) {
      removeGateEntry(
        telegramId
      );

      return response(
        {
          error:
            'Invalid check-in result',
        },
        500
      );
    }

    // =================================================
    // Supabase says today's reward was already claimed.
    //
    // This response comes directly from Supabase, so
    // returning balance here is safe and authoritative.
    //
    // Only completion/streak/date are stored locally.
    // =================================================

    if (
      !result.success
    ) {
      if (
        result.error_code ===
        'ALREADY_CLAIMED'
      ) {
        const balance =
          Number(
            result.balance || 0
          );

        const checkinStreak =
          Number(
            result.checkin_streak ||
            0
          );

        const lastCheckinDate =
          result.last_checkin_date ||
          null;

        setGateEntry(
          telegramId,
          {
            dayKey: today,
            inFlight: false,
            completed: true,
            checkinStreak,
            lastCheckinDate,
          }
        );

        return response(
          {
            error:
              'Daily check-in already claimed',

            balance,

            checkinStreak,

            lastCheckinDate,
          },
          409
        );
      }

      if (
        result.error_code ===
        'USER_NOT_FOUND'
      ) {
        removeGateEntry(
          telegramId
        );

        return response(
          {
            error:
              'User not found',
          },
          404
        );
      }

      removeGateEntry(
        telegramId
      );

      return response(
        {
          error:
            'Check-in failed',
        },
        400
      );
    }

    // =================================================
    // Successful check-in.
    //
    // Balance is returned directly from Supabase.
    //
    // The local gate stores only stable check-in state,
    // never the user's balance.
    // =================================================

    const reward =
      Number(
        result.reward || 0
      );

    const balance =
      Number(
        result.balance || 0
      );

    const checkinStreak =
      Number(
        result.checkin_streak ||
        0
      );

    const lastCheckinDate =
      result.last_checkin_date ||
      null;

    setGateEntry(
      telegramId,
      {
        dayKey: today,
        inFlight: false,
        completed: true,
        checkinStreak,
        lastCheckinDate,
      }
    );

    return response({
      success: true,

      reward,

      balance,

      checkinStreak,

      lastCheckinDate,
    });

  } catch (error) {
    // Release only an unfinished local gate.
    if (gatedTelegramId) {
      const entry =
        dailyCheckinGate.get(
          gatedTelegramId
        );

      if (
        entry?.inFlight ===
        true
      ) {
        removeGateEntry(
          gatedTelegramId
        );
      }
    }

    const message =
      error instanceof Error
        ? error.message
        : 'Unknown error';

    const isAuthError =
      message.includes(
        'Telegram'
      ) ||
      message.includes(
        'BOT_TOKEN'
      ) ||
      message.includes(
        'Expired'
      );

    return response(
      {
        error:
          isAuthError
            ? 'Invalid Telegram authentication'
            : 'Internal server error',
      },
      isAuthError
        ? 401
        : 500
    );
  }
}
