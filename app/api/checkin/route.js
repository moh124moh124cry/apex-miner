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
// Supabase remains the final authority for:
// - Daily reward
// - Balance
// - Streak
// - Active days
// - Recovery state
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
  dailyCheckinGate.delete(
    telegramId
  );

  dailyCheckinGate.set(
    telegramId,
    entry
  );

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

    const clientV2 =
      body?.clientV2 === true;

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

    if (initData.length > 8192) {
      return response(
        {
          error:
            'Invalid Telegram init data',
        },
        400
      );
    }

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
    // Supabase already confirmed that this user
    // completed today's check-in.
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

          activeDays:
            Number(
              existingGate
                .activeDays ||
              0
            ),

          recoveryDays:
            Number(
              existingGate
                .recoveryDays ??
              2
            ),

          rewardEligible:
            Boolean(
              existingGate
                .rewardEligible
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
    // Another request for the same user is already
    // reaching Supabase on this Vercel instance.
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

    setGateEntry(
      telegramId,
      {
        dayKey: today,
        inFlight: true,
        completed: false,
        checkinStreak: null,
        activeDays: null,
        recoveryDays: null,
        rewardEligible: null,
        lastCheckinDate: null,
      }
    );

    // =================================================
    // Transitional authoritative Supabase RPC.
    //
    // IMPORTANT:
    // It preserves the current production reward
    // schedule while also returning the new activity
    // fields needed for the upcoming frontend cutover.
    // =================================================

    const {
      data,
      error,
    } =
      await supabaseAdmin.rpc(
        'apex_daily_checkin_client_rollout',
        {
          p_telegram_id:
            telegramId,
          p_client_v2:
            clientV2,
        }
      );

    if (error) {
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

        const activeDays =
          Number(
            result.active_days ||
            0
          );

        const recoveryDays =
          Math.max(
            0,
            Math.min(
              2,
              Number(
                result.recovery_days ??
                2
              )
            )
          );

        const rewardEligible =
          Boolean(
            result.reward_eligible
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
            activeDays,
            recoveryDays,
            rewardEligible,
            lastCheckinDate,
          }
        );

        return response(
          {
            error:
              'Daily check-in already claimed',

            balance,

            checkinStreak,

            activeDays,

            recoveryDays,

            rewardEligible,

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

    const activeDays =
      Number(
        result.active_days ||
        0
      );

    const recoveryDays =
      Math.max(
        0,
        Math.min(
          2,
          Number(
            result.recovery_days ??
            2
          )
        )
      );

    const rewardEligible =
      Boolean(
        result.reward_eligible
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
        activeDays,
        recoveryDays,
        rewardEligible,
        lastCheckinDate,
      }
    );

    return response({
      success: true,

      reward,

      balance,

      checkinStreak,

      activeDays,

      recoveryDays,

      rewardEligible,

      lastCheckinDate,
    });

  } catch (error) {
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

