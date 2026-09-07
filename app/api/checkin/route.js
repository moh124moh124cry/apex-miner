import { NextResponse } from 'next/server';
import { supabaseAdmin } from '../../../lib/supabase-admin';
import { validateTelegramInitData } from '../../../lib/telegram-auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

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

    if (!initData || typeof initData !== 'string') {
      return response(
        { error: 'Telegram init data is required' },
        400
      );
    }

    const telegram = validateTelegramInitData(initData);
    const telegramId = String(telegram.user.id);

    // استدعاء واحد فقط إلى Supabase
    const { data, error } = await supabaseAdmin.rpc(
      'apex_daily_checkin',
      {
        p_telegram_id: telegramId,
      }
    );

    if (error) {
      console.error('Check-in RPC error:', error.code);

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
        { error: 'Invalid check-in result' },
        500
      );
    }

    if (!result.success) {
      if (result.error_code === 'ALREADY_CLAIMED') {
        return response(
          {
            error: 'Daily check-in already claimed',
            balance: Number(result.balance || 0),
            checkinStreak: Number(
              result.checkin_streak || 0
            ),
          },
          409
        );
      }

      if (result.error_code === 'USER_NOT_FOUND') {
        return response(
          { error: 'User not found' },
          404
        );
      }

      return response(
        { error: 'Check-in failed' },
        400
      );
    }

    return response({
      success: true,
      reward: Number(result.reward || 0),
      balance: Number(result.balance || 0),
      checkinStreak: Number(
        result.checkin_streak || 0
      ),
      lastCheckinDate:
        result.last_checkin_date || null,
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
