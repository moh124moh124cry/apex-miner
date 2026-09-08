import { NextResponse } from 'next/server';
import { supabaseAdmin } from '../../../../lib/supabase-admin';
import { validateTelegramInitData } from '../../../../lib/telegram-auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const ALLOWED_TASKS = new Set([
  'telegram',
  'twitter',
]);

// =====================================================
// Lightweight per-instance Daily Tasks gate
// =====================================================
//
// Performance optimization only.
//
// Vercel may run multiple instances, therefore this map
// is NOT a security boundary.
//
// Supabase apex_claim_daily_task remains the final
// authority for:
// - 100 APXN reward
// - Balance
// - Daily duplicate prevention
// - Atomic row locking
//
// IMPORTANT:
// The local gate never stores or returns balance.
// Balance may change through mining/check-in/social tasks,
// so only Supabase responses may synchronize balance.
// =====================================================

const MAX_GATE_ENTRIES = 5000;

const dailyTaskGate =
  globalThis.__apexDailyTaskGate ||
  new Map();

if (!globalThis.__apexDailyTaskGate) {
  globalThis.__apexDailyTaskGate =
    dailyTaskGate;
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

function getGateKey(
  telegramId,
  task
) {
  return `${telegramId}:${task}`;
}

function setGateEntry(
  gateKey,
  entry
) {
  // Refresh insertion order.
  dailyTaskGate.delete(
    gateKey
  );

  dailyTaskGate.set(
    gateKey,
    entry
  );

  // Keep transient memory bounded.
  while (
    dailyTaskGate.size >
    MAX_GATE_ENTRIES
  ) {
    const oldestKey =
      dailyTaskGate
        .keys()
        .next()
        .value;

    if (
      oldestKey === undefined
    ) {
      break;
    }

    dailyTaskGate.delete(
      oldestKey
    );
  }
}

function removeGateEntry(
  gateKey
) {
  dailyTaskGate.delete(
    gateKey
  );
}

function getValidGateEntry(
  gateKey
) {
  const entry =
    dailyTaskGate.get(
      gateKey
    );

  if (!entry) {
    return null;
  }

  const today =
    getUtcDayKey();

  // Yesterday's state must never block today's task.
  if (
    entry.dayKey &&
    entry.dayKey !== today
  ) {
    removeGateEntry(
      gateKey
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
// Daily Task
// =====================================================

export async function POST(
  request
) {
  let activeGateKey = null;

  try {
    const body =
      await request.json();

    const initData =
      body?.initData;

    const task =
      body?.task;

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

    if (
      initData.length >
      8192
    ) {
      return response(
        {
          error:
            'Invalid Telegram init data',
        },
        400
      );
    }

    if (
      !ALLOWED_TASKS.has(
        task
      )
    ) {
      return response(
        {
          error:
            'Invalid daily task',
        },
        400
      );
    }

    // =================================================
    // Authenticate the actual Telegram Mini App user.
    // =================================================

    const telegram =
      validateTelegramInitData(
        initData
      );

    const telegramId =
      String(
        telegram.user.id
      );

    const today =
      getUtcDayKey();

    const gateKey =
      getGateKey(
        telegramId,
        task
      );

    activeGateKey =
      gateKey;

    const existingGate =
      getValidGateEntry(
        gateKey
      );

    // =================================================
    // 1. Supabase already confirmed this task was
    //    completed today.
    //
    //    Return immediately without touching Supabase.
    //
    //    IMPORTANT:
    //    Do NOT return balance from local memory.
    //    The balance may have changed after this task.
    // =================================================

    if (
      existingGate?.completed ===
      true
    ) {
      return response(
        {
          error:
            'Daily task already claimed',

          lastTaskDate:
            existingGate
              .lastTaskDate ||
            today,

          completed: true,
        },
        409
      );
    }

    // =================================================
    // 2. Another identical request is already reaching
    //    Supabase on this Vercel instance.
    //
    //    Stop concurrent duplicate requests.
    // =================================================

    if (
      existingGate?.inFlight ===
      true
    ) {
      return response(
        {
          error:
            'Daily task request already in progress',

          retryAfter: 1,

          completed: false,
        },
        429
      );
    }

    // =================================================
    // Mark this user + task as in-flight before the RPC.
    //
    // Telegram and Twitter remain independent.
    // =================================================

    setGateEntry(
      gateKey,
      {
        dayKey: today,
        inFlight: true,
        completed: false,
        lastTaskDate: null,
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
        'apex_claim_daily_task',
        {
          p_telegram_id:
            telegramId,

          p_task:
            task,
        }
      );

    if (error) {
      // Do not leave a legitimate user blocked after
      // a database error.
      removeGateEntry(
        gateKey
      );

      console.error(
        'Daily task RPC error:',
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
        gateKey
      );

      return response(
        {
          error:
            'Invalid daily task result',
        },
        500
      );
    }

    // =================================================
    // Supabase confirmed this task was already completed.
    //
    // This response is authoritative, so balance may be
    // returned to the frontend here.
    //
    // The local gate stores only completion/date.
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

        const lastTaskDate =
          result.last_task_date ||
          today;

        setGateEntry(
          gateKey,
          {
            dayKey: today,
            inFlight: false,
            completed: true,
            lastTaskDate,
          }
        );

        return response(
          {
            error:
              'Daily task already claimed',

            balance,

            lastTaskDate,

            completed: true,
          },
          409
        );
      }

      if (
        result.error_code ===
        'USER_NOT_FOUND'
      ) {
        removeGateEntry(
          gateKey
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
        gateKey
      );

      return response(
        {
          error:
            'Daily task failed',
        },
        400
      );
    }

    // =================================================
    // Successful daily task.
    //
    // Balance is returned directly from Supabase.
    //
    // The local gate stores only today's completion
    // state and date, never balance.
    // =================================================

    const reward =
      Number(
        result.reward || 0
      );

    const balance =
      Number(
        result.balance || 0
      );

    const lastTaskDate =
      result.last_task_date ||
      today;

    setGateEntry(
      gateKey,
      {
        dayKey: today,
        inFlight: false,
        completed: true,
        lastTaskDate,
      }
    );

    return response({
      success: true,

      task,

      reward,

      balance,

      lastTaskDate,

      completed: true,
    });

  } catch (error) {
    // Release only an unfinished local request.
    if (activeGateKey) {
      const entry =
        dailyTaskGate.get(
          activeGateKey
        );

      if (
        entry?.inFlight ===
        true
      ) {
        removeGateEntry(
          activeGateKey
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

    if (!isAuthError) {
      console.error(
        'Daily task API error:',
        message
      );
    }

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
