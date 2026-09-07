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

// Official Telegram destinations already used by the app.
const TELEGRAM_TASK_CHATS = {
  channel: '@ApexMiner_Official',
  group: '@ApexMinerGroup',
};

function response(body, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: {
      'Cache-Control': 'no-store',
    },
  });
}

// ======================================================
// Telegram membership verification
// ======================================================

function isActiveTelegramMember(member) {
  if (!member?.status) {
    return false;
  }

  if (
    member.status === 'creator' ||
    member.status === 'administrator' ||
    member.status === 'member'
  ) {
    return true;
  }

  // A restricted user may still be an active member.
  if (member.status === 'restricted') {
    return member.is_member === true;
  }

  // "left" and "kicked" are not members.
  return false;
}

async function getTelegramChatMember(
  chatId,
  userId
) {
  const botToken = process.env.BOT_TOKEN;

  if (!botToken) {
    throw new Error('Missing BOT_TOKEN');
  }

  const controller = new AbortController();

  const timeout = setTimeout(() => {
    controller.abort();
  }, 8000);

  try {
    const telegramResponse = await fetch(
      `https://api.telegram.org/bot${botToken}/getChatMember`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          chat_id: chatId,
          user_id: userId,
        }),
        cache: 'no-store',
        signal: controller.signal,
      }
    );

    let telegramData = null;

    try {
      telegramData =
        await telegramResponse.json();
    } catch {
      telegramData = null;
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
    clearTimeout(timeout);
  }
}

async function verifyTelegramMembership(
  task,
  userId
) {
  const chatId =
    TELEGRAM_TASK_CHATS[task];

  if (!chatId) {
    return false;
  }

  const member =
    await getTelegramChatMember(
      chatId,
      userId
    );

  return isActiveTelegramMember(
    member
  );
}

// ======================================================
// Social task claim
// ======================================================

export async function POST(request) {
  try {
    const body = await request.json();

    const initData = body?.initData;
    const task = body?.task;

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

    if (!ALLOWED_TASKS.has(task)) {
      return response(
        {
          error: 'Invalid task',
        },
        400
      );
    }

    // Verify the actual Telegram Mini App user.
    const telegram =
      validateTelegramInitData(
        initData
      );

    const telegramId =
      String(telegram.user.id);

    // ==================================================
    // Only channel/group require real Telegram
    // membership verification.
    //
    // Twitter remains exactly as it worked before.
    // ==================================================

    if (
      task === 'channel' ||
      task === 'group'
    ) {
      let isMember = false;

      try {
        isMember =
          await verifyTelegramMembership(
            task,
            telegram.user.id
          );
      } catch (error) {
        const message =
          error instanceof Error
            ? error.message
            : 'Unknown error';

        console.error(
          'Telegram membership verification error:',
          message
        );

        // Never award points if Telegram
        // membership could not be verified.
        return response(
          {
            error:
              'Unable to verify Telegram membership',
            completed: false,
          },
          503
        );
      }

      if (!isMember) {
        return response(
          {
            error:
              task === 'channel'
                ? 'Please join the official Telegram channel first'
                : 'Please join the official Telegram group first',
            completed: false,
          },
          403
        );
      }
    }

    // ==================================================
    // Existing Supabase reward system
    //
    // channel = 500
    // group   = 500
    // twitter = existing 500-point follow task
    // ==================================================

    const { data, error } =
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
      console.error(
        'Social task RPC error:',
        error.code
      );

      return response(
        {
          error: 'Database error',
        },
        500
      );
    }

    const result =
      Array.isArray(data)
        ? data[0]
        : data;

    if (!result) {
      return response(
        {
          error:
            'Invalid task result',
        },
        500
      );
    }

    if (!result.success) {
      if (
        result.error_code ===
        'ALREADY_CLAIMED'
      ) {
        return response(
          {
            error:
              'Task already claimed',
            balance:
              Number(
                result.balance || 0
              ),
            completed: true,
          },
          409
        );
      }

      if (
        result.error_code ===
        'USER_NOT_FOUND'
      ) {
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
        return response(
          {
            error:
              'Invalid task',
          },
          400
        );
      }

      return response(
        {
          error: 'Task failed',
        },
        400
      );
    }

    return response({
      success: true,
      task,
      reward:
        Number(
          result.reward || 0
        ),
      balance:
        Number(
          result.balance || 0
        ),
      completed:
        Boolean(
          result.task_completed
        ),
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
      isAuthError ? 401 : 500
    );
  }
}
