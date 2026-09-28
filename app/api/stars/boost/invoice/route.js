import { NextResponse } from 'next/server';
import { supabaseAdmin } from '../../../../../lib/supabase-admin';
import { validateTelegramInitData } from '../../../../../lib/telegram-auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const STARS_PRICE = 10;
const BOOST_DURATION_HOURS = 48;
const BOOST_REWARD_POINTS = 10000;

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

    if (
      !initData ||
      typeof initData !== 'string' ||
      initData.length > 8192
    ) {
      return response(
        {
          error: 'Invalid Telegram init data',
        },
        400
      );
    }

    const telegram = validateTelegramInitData(initData);
    const telegramId = String(telegram.user.id);

    const {
      data: user,
      error: userError,
    } = await supabaseAdmin
      .from('users')
      .select('stars_boost_until')
      .eq('telegram_id', telegramId)
      .maybeSingle();

    if (userError) {
      console.error(
        'Stars boost user lookup error:',
        userError.code
      );

      return response(
        {
          error: 'Database error',
        },
        500
      );
    }

    if (!user) {
      return response(
        {
          error: 'User not found',
        },
        404
      );
    }

    const currentUntil = user.stars_boost_until
      ? new Date(user.stars_boost_until).getTime()
      : 0;

    if (
      Number.isFinite(currentUntil) &&
      currentUntil > Date.now()
    ) {
      return response(
        {
          error: 'Stars boost already active',
          active: true,
          starsBoostUntil: user.stars_boost_until,
        },
        409
      );
    }

    const botToken = process.env.BOT_TOKEN;

    if (!botToken) {
      console.error(
        'BOT_TOKEN missing for Telegram Stars invoice'
      );

      return response(
        {
          error: 'Payment service unavailable',
        },
        503
      );
    }

    const payload =
      `apxn48:${telegramId}:${Date.now()}`;

    const telegramResponse = await fetch(
      `https://api.telegram.org/bot${botToken}/createInvoiceLink`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          title: 'APXN 48H Mining Boost',
          description:
            'Get 10,000 APXN POINTS progressively through mining for 48 hours. Free mining and ad mining remain active.',
          payload,
          provider_token: '',
          currency: 'XTR',
          prices: [
            {
              label:
                '48H Boost — 10,000 APXN POINTS',
              amount: STARS_PRICE,
            },
          ],
        }),
        cache: 'no-store',
      }
    );

    const telegramData =
      await telegramResponse.json();

    if (
      !telegramResponse.ok ||
      !telegramData?.ok ||
      !telegramData?.result
    ) {
      console.error(
        'Telegram createInvoiceLink error:',
        telegramData?.description ||
          telegramResponse.status
      );

      return response(
        {
          error:
            'Could not create Telegram Stars invoice',
        },
        502
      );
    }

    return response({
      success: true,
      invoiceLink: telegramData.result,
      stars: STARS_PRICE,
      durationHours: BOOST_DURATION_HOURS,
      rewardPoints: BOOST_REWARD_POINTS,
      rewardLabel: '10,000 APXN POINTS',
    });
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : 'Unknown error';

    const isAuthError =
      message.includes('Telegram') ||
      message.includes('init data') ||
      message.includes('auth');

    if (!isAuthError) {
      console.error(
        'Stars boost invoice API error:',
        message
      );
    }

    return response(
      {
        error: isAuthError
          ? 'Invalid Telegram authentication'
          : 'Payment service error',
      },
      isAuthError ? 401 : 500
    );
  }
}

