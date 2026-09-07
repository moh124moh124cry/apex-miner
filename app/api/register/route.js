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

    if (initData.length > 8192) {
      return response(
        { error: 'Invalid Telegram init data' },
        400
      );
    }

    const telegram = validateTelegramInitData(initData);

    const telegramId = String(telegram.user.id);

    const firstName =
      telegram.user.first_name || '';

    const username =
      telegram.user.username || '';

    let referrerId = null;

    const startParam = telegram.startParam;

    if (
      startParam &&
      /^\d+$/.test(String(startParam)) &&
      String(startParam) !== telegramId
    ) {
      referrerId = String(startParam);
    }

    // عملية واحدة فقط إلى Supabase
    const { data, error } = await supabaseAdmin.rpc(
      'apex_register_user',
      {
        p_telegram_id: telegramId,
        p_first_name: firstName,
        p_username: username,
        p_referrer_id: referrerId,
      }
    );

    if (error) {
      console.error(
        'Register user RPC error:',
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

    if (!result || !result.success) {
      return response(
        { error: 'Registration failed' },
        500
      );
    }

    return response({
      success: true,

      created: Boolean(result.created),

      user: {
        telegramId,

        firstName,

        username,

        balance: Number(
          result.balance || 0
        ),

        miningRate: Number(
          result.mining_rate || 0.00025
        ),

        referredBy:
          result.referred_by
            ? String(result.referred_by)
            : null,

        lastClaim:
          result.last_claim || null,
      },

      welcomeBonus: Number(
        result.welcome_bonus || 0
      ),

      referralBonus: Number(
        result.referral_bonus || 0
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
        'Register API error:',
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
