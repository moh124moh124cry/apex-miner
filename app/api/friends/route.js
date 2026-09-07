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
    const requestedLimit = Number(body?.limit ?? 50);
    const requestedOffset = Number(body?.offset ?? 0);

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

    const telegram = validateTelegramInitData(initData);

    const telegramId = telegram.user.id;

    const limit = Number.isInteger(requestedLimit)
      ? Math.min(Math.max(requestedLimit, 1), 100)
      : 50;

    const offset =
      Number.isInteger(requestedOffset) && requestedOffset >= 0
        ? requestedOffset
        : 0;

    const { data, error } = await supabaseAdmin.rpc(
      'apex_get_friends',
      {
        p_telegram_id: telegramId,
        p_limit: limit,
        p_offset: offset,
      }
    );

    if (error) {
      console.error('Friends RPC error:', error.code);

      return response(
        { error: 'Database error' },
        500
      );
    }

    const result = Array.isArray(data)
      ? data[0]
      : data;

    const totalFriends = Number(
      result?.total_friends || 0
    );

    const activeFriends = Number(
      result?.active_friends || 0
    );

    const friends = Array.isArray(result?.friends)
      ? result.friends
      : [];

    return response({
      success: true,
      totalFriends,
      activeFriends,
      friends,
      offset,
      limit,
      hasMore: offset + friends.length < totalFriends,
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
        'Friends API error:',
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
