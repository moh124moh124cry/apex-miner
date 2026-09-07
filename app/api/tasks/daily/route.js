import { NextResponse } from 'next/server';
import { supabaseAdmin } from '../../../../lib/supabase-admin';
import { validateTelegramInitData } from '../../../../lib/telegram-auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const ALLOWED_TASKS = new Set([
  'telegram',
  'twitter',
]);

function response(body, status = 200) {
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
    const task = body?.task;

    if (!initData || typeof initData !== 'string') {
      return response(
        { error: 'Telegram init data is required' },
        400
      );
    }

    if (initData.length > 8192) {
      return response(
        { error: 'Invalid Telegram init data' },
        400
      );
    }

    if (!ALLOWED_TASKS.has(task)) {
      return response(
        { error: 'Invalid daily task' },
        400
      );
    }

    const telegram =
      validateTelegramInitData(initData);

    const telegramId =
      String(telegram.user.id);

    // استدعاء واحد فقط إلى Supabase
    const { data, error } =
      await supabaseAdmin.rpc(
        'apex_claim_daily_task',
        {
          p_telegram_id: telegramId,
          p_task: task,
        }
      );

    if (error) {
      console.error(
        'Daily task RPC error:',
        error.code
      );

      return response(
        { error: 'Database error' },
        500
      );
    }

    const result = Array.isArray(data)
      ? data[0]
      : data;

    if (!result) {
      return response(
        { error: 'Invalid daily task result' },
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
            error: 'Daily task already claimed',
            balance: Number(
              result.balance || 0
            ),
            lastTaskDate:
              result.last_task_date || null,
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
          { error: 'User not found' },
          404
        );
      }

      return response(
        { error: 'Daily task failed' },
        400
      );
    }

    return response({
      success: true,
      task,
      reward: Number(
        result.reward || 0
      ),
      balance: Number(
        result.balance || 0
      ),
      lastTaskDate:
        result.last_task_date || null,
      completed: true,
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
        'Daily task API error:',
        message
      );
    }

    return response(
      {
        error: isAuthError
          ? 'Invalid Telegram authentication'
          : 'Internal server error',
      },
      isAuthError ? 401 : 500
    );
  }
}
