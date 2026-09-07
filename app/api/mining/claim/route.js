import { NextResponse } from 'next/server';
import { supabaseAdmin } from '../../../../lib/supabase-admin';
import { validateTelegramInitData } from '../../../../lib/telegram-auth';

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

    if (initData.length > 8192) {
      return response(
        { error: 'Invalid Telegram init data' },
        400
      );
    }

    const telegram =
      validateTelegramInitData(initData);

    const telegramId =
      String(telegram.user.id);

    // عملية واحدة فقط إلى Supabase
    const { data, error } =
      await supabaseAdmin.rpc(
        'apex_mining_claim',
        {
          p_telegram_id: telegramId,
        }
      );

    if (error) {
      console.error(
        'Mining claim RPC error:',
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
        { error: 'Invalid mining claim result' },
        500
      );
    }

    if (!result.success) {
      if (result.error_code === 'COOLDOWN') {
        return response(
          {
            error: 'Claim cooldown active',

            balance: Number(
              result.balance || 0
            ),

            retryAfter: Number(
              result.retry_after || 0
            ),

            cooldown: Number(
              result.cooldown || 43200
            ),

            lastClaim:
              result.last_claim || null,
          },
          429
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
        { error: 'Claim failed' },
        400
      );
    }

    return response({
      success: true,

      balance: Number(
        result.balance || 0
      ),

      claimed: Number(
        result.claimed || 0
      ),

      miningRate: Number(
        result.mining_rate || 0.00025
      ),

      baseMiningRate: Number(
        result.base_mining_rate || 0.00025
      ),

      activeFriends: Number(
        result.active_friends || 0
      ),

      lastClaim:
        result.last_claim || null,

      cooldown: Number(
        result.cooldown || 43200
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
        'Mining claim API error:',
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
