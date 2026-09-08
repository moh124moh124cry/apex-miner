import { NextResponse } from 'next/server';
import { supabaseAdmin } from '../../../../lib/supabase-admin';
import { validateTelegramInitData } from '../../../../lib/telegram-auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const ALLOWED_TASKS = new Set([
  'channel',
  'group',
  'twitter',
]);

const TELEGRAM_TASK_CHATS = {
  channel: '@ApexMiner_Official',
  group: '@ApexMinerGroup',
};

// =====================================================
// Lightweight per-instance one-time Social Tasks gate
// =====================================================
//
// Performance optimization only.
//
// Vercel may run multiple instances, therefore this map
// is NOT a security boundary.
//
// Supabase apex_claim_social_task remains the final
// authority for:
// - 500 APXN rewards
// - Duplicate prevention
// - Balance
// - Atomic row locking
//
// IMPORTANT:
// The local gate never stores or returns balance.
// Balance can change through mining/check-in/daily tasks.
// =====================================================

const MAX_GATE_ENTRIES = 5000;

const socialTaskGate =
  globalThis.__apexSocialTaskGate ||
  new Map();

if (!globalThis.__apexSocialTaskGate) {
  globalThis.__apexSocialTaskGate =
    socialTaskGate;
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
  socialTaskGate.delete(
    gateKey
  );

  socialTaskGate.set(
    gateKey,
    entry
  );

  // Keep transient Vercel memory bounded.
  while (
    socialTaskGate.size >
    MAX_GATE_ENTRIES
  ) {
    const oldestKey =
      socialTaskGate
        .keys()
        .next()
        .value;

    if (
      oldestKey === undefined
    ) {
      break;
    }

    socialTaskGate.delete(
      oldestKey
    );
  }
}

function removeGateEntry(
  gateKey
) {
  socialTaskGate.delete(
    gateKey
  );
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
// Telegram membership verification
// =====================================================

function isActiveTelegramMember(
  member
) {
  if (!member?.status) {
    return false;
  }

  if (
    member.status ===
      'creator' ||
    member.status ===
      'administrator' ||
    member.status ===
      'member'
  ) {
    return true;
  }

  // Restricted users may still remain members.
  if (
    member.status ===
    'restricted'
  ) {
    return (
      member.is_member ===
      true
    );
  }

  // left / kicked are not members.
  return false;
}

async function getTelegramChatMember(
  chatId,
  userId
) {
  const botToken =
    process.env.BOT_TOKEN;

  if (!botToken) {
    throw new Error(
      'Missing BOT_TOKEN'
    );
  }

  const controller =
    new AbortController();

  const timeout =
    setTimeout(
      () => {
        controller.abort();
      },
      8000
    );

  try {
    const telegramResponse =
      await fetch(
        `https://api.telegram.org/bot${botToken}/getChatMember`,
        {
          method: 'POST',

          headers: {
            'Content-Type':
              'application/json',
          },

          body:
            JSON.stringify({
              chat_id:
                chatId,

              user_id:
                userId,
            }),

          cache: 'no-store',

          signal:
            controller.signal,
        }
      );

    let telegramData =
      null;

    try {
      telegramData =
        await telegramResponse
          .json();
    } catch {
      telegramData =
        null;
    }

    if (
      !telegramResponse.ok ||
      !telegramData?.ok ||
      !telegramData?.result
    ) {
      throw new Error(
        'Telegram membership verification failed'
      );
    }

    return telegramData.result;

  } finally {
    clearTimeout(
      timeout
    );
  }
}

async function verifyTelegramMembership(
  task,
  userId
) {
  const chatId =
    TELEGRAM_TASK_CHATS[
      task
    ];

  if (!chatId) {
    return false;
  }

  const member =
    await getTelegramChatMember(
      chatId,
      userId
    );

  return (
    isActiveTelegramMember(
      member
    )
  );
}

// =====================================================
// Database completion pre-check
// =====================================================

function getTaskCompletionStatus(
  user,
  task
) {
  if (
    task === 'channel'
  ) {
    return Boolean(
      user.channel_joined
    );
  }

  if (
    task === 'group'
  ) {
    return Boolean(
      user.group_joined
    );
  }

  if (
    task === 'twitter'
  ) {
    return Boolean(
      user.twitter_joined
    );
  }

  return false;
}

// =====================================================
// Social task claim
// =====================================================

export async function POST(
  request
) {
  let activeGateKey =
    null;

  try {
    const body =
      await request.json();

    const initData =
      body?.initData;

    const task =
      body?.task;

    if (
      !initData ||
      typeof initData !==
        'string'
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
      !ALLOWED_TASKS.has(
        task
      )
    ) {
      return response(
        {
          error:
            'Invalid task',
        },
        400
      );
    }

    // Central validation also enforces initData size.
    const telegram =
      validateTelegramInitData(
        initData
      );

    const telegramId =
      String(
        telegram.user.id
      );

    const gateKey =
      getGateKey(
        telegramId,
        task
      );

    activeGateKey =
      gateKey;

    const existingGate =
      socialTaskGate.get(
        gateKey
      );

    // =================================================
    // 1. This Vercel instance already knows that the
    //    one-time task has been completed.
    //
    //    No Supabase read.
    //    No Telegram API call.
    //    No reward RPC.
    //
    //    Never return cached balance.
    // =================================================

    if (
      existingGate
        ?.completed === true
    ) {
      return response(
        {
          error:
            'Task already claimed',

          completed:
            true,
        },
        409
      );
    }

    // =================================================
    // 2. Another identical request is already being
    //    processed on this Vercel instance.
    // =================================================

    if (
      existingGate
        ?.inFlight === true
    ) {
      return response(
        {
          error:
            'Task request already in progress',

          retryAfter:
            1,

          completed:
            false,
        },
        429
      );
    }

    // Mark before any Supabase / Telegram work.
    setGateEntry(
      gateKey,
      {
        inFlight:
          true,

        completed:
          false,
      }
    );

    // =================================================
    // Fast indexed database pre-check.
    //
    // We intentionally do NOT select balance.
    //
    // If the task is already completed, this avoids
    // Telegram getChatMember and the locking reward RPC.
    // =================================================

    const {
      data: user,
      error: userError,
    } =
      await supabaseAdmin
        .from('users')
        .select(`
          channel_joined,
          group_joined,
          twitter_joined
        `)
        .eq(
          'telegram_id',
          telegramId
        )
        .maybeSingle();

    if (userError) {
      removeGateEntry(
        gateKey
      );

      console.error(
        'Social task pre-check error:',
        userError.code
      );

      return response(
        {
          error:
            'Database error',
        },
        500
      );
    }

    if (!user) {
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

    const alreadyCompleted =
      getTaskCompletionStatus(
        user,
        task
      );

    // =================================================
    // Database confirms this one-time task was already
    // completed.
    //
    // Cache completion locally, but NEVER balance.
    // =================================================

    if (
      alreadyCompleted
    ) {
      setGateEntry(
        gateKey,
        {
          inFlight:
            false,

          completed:
            true,
        }
      );

      return response(
        {
          error:
            'Task already claimed',

          completed:
            true,
        },
        409
      );
    }

    // =================================================
    // Telegram channel/group:
    // require real membership verification.
    //
    // Twitter remains unchanged and does not use
    // external X verification.
    // =================================================

    if (
      task === 'channel' ||
      task === 'group'
    ) {
      let isMember =
        false;

      try {
        isMember =
          await verifyTelegramMembership(
            task,
            telegram.user.id
          );

      } catch (error) {
        removeGateEntry(
          gateKey
        );

        const message =
          error instanceof Error
            ? error.message
            : 'Unknown error';

        console.error(
          'Telegram membership verification error:',
          message
        );

        // Never award points if Telegram
        // membership cannot be verified.
        return response(
          {
            error:
              'Unable to verify Telegram membership',

            completed:
              false,
          },
          503
        );
      }

      if (!isMember) {
        removeGateEntry(
          gateKey
        );

        return response(
          {
            error:
              task ===
              'channel'
                ? 'Please join the official Telegram channel first'
                : 'Please join the official Telegram group first',

            completed:
              false,
          },
          403
        );
      }
    }

    // =================================================
    // Authoritative atomic reward RPC.
    //
    // channel = 500 APXN
    // group   = 500 APXN
    // twitter = 500 APXN
    //
    // Rewards are unchanged.
    // =================================================

    const {
      data,
      error,
    } =
      await supabaseAdmin.rpc(
        'apex_claim_social_task',
        {
          p_telegram_id:
            telegramId,

          p_task:
            task,
        }
      );

    if (error) {
      removeGateEntry(
        gateKey
      );

      console.error(
        'Social task RPC error:',
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
            'Invalid task result',
        },
        500
      );
    }

    if (
      !result.success
    ) {
      // ===============================================
      // Supabase is authoritative.
      //
      // Here returning balance is safe because the
      // response came directly from the database RPC.
      //
      // The balance itself is NOT stored in local gate.
      // ===============================================

      if (
        result.error_code ===
        'ALREADY_CLAIMED'
      ) {
        setGateEntry(
          gateKey,
          {
            inFlight:
              false,

            completed:
              true,
          }
        );

        return response(
          {
            error:
              'Task already claimed',

            balance:
              Number(
                result.balance ||
                0
              ),

            completed:
              true,
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

      if (
        result.error_code ===
        'INVALID_TASK'
      ) {
        removeGateEntry(
          gateKey
        );

        return response(
          {
            error:
              'Invalid task',
          },
          400
        );
      }

      removeGateEntry(
        gateKey
      );

      return response(
        {
          error:
            'Task failed',
        },
        400
      );
    }

    // =================================================
    // Successful one-time task.
    //
    // Store only completion state locally.
    // Never cache balance in server memory.
    // =================================================

    setGateEntry(
      gateKey,
      {
        inFlight:
          false,

        completed:
          true,
      }
    );

    return response({
      success:
        true,

      task,

      reward:
        Number(
          result.reward ||
          0
        ),

      balance:
        Number(
          result.balance ||
          0
        ),

      completed:
        Boolean(
          result.task_completed
        ),
    });

  } catch (error) {
    // Release only an unfinished local request.
    if (activeGateKey) {
      const entry =
        socialTaskGate.get(
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
        'Social task API error:',
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
