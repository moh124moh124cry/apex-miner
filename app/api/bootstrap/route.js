import { NextResponse } from 'next/server';
import { supabaseAdmin } from '../../../lib/supabase-admin';
import { validateTelegramInitData } from '../../../lib/telegram-auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request) {
  try {
    const body = await request.json();
    const initData = body?.initData;

    if (!initData || typeof initData !== 'string') {
      return NextResponse.json(
        { error: 'Telegram init data is required' },
        {
          status: 400,
          headers: {
            'Cache-Control': 'no-store',
          },
        }
      );
    }

    if (initData.length > 8192) {
      return NextResponse.json(
        { error: 'Invalid Telegram init data' },
        {
          status: 400,
          headers: {
            'Cache-Control': 'no-store',
          },
        }
      );
    }

    const telegram = validateTelegramInitData(initData);
    const telegramId = String(telegram.user.id);

    const { data: user, error } = await supabaseAdmin
      .from('users')
      .select(`
        telegram_id,
        first_name,
        username,
        balance,
        mining_rate,
        referred_by,
        channel_joined,
        group_joined,
        twitter_joined,
        last_twitter_task,
        last_telegram_task,
        checkin_streak,
        last_checkin_date,
        last_claim,
        country
      `)
      .eq('telegram_id', telegramId)
      .maybeSingle();

    if (error) {
      console.error('Bootstrap database error:', error.code);

      return NextResponse.json(
        { error: 'Database error' },
        {
          status: 500,
          headers: {
            'Cache-Control': 'no-store',
          },
        }
      );
    }

    if (!user) {
      return NextResponse.json(
        {
          success: true,
          exists: false,
          telegram: {
            id: telegram.user.id,
            firstName: telegram.user.first_name || '',
            lastName: telegram.user.last_name || '',
            username: telegram.user.username || '',
            languageCode: telegram.user.language_code || '',
          },
          startParam: telegram.startParam,
        },
        {
          status: 200,
          headers: {
            'Cache-Control': 'no-store',
          },
        }
      );
    }

    return NextResponse.json(
      {
        success: true,
        exists: true,
        user: {
          telegramId: String(user.telegram_id),
          firstName: user.first_name || '',
          username: user.username || '',
          balance: Number(user.balance || 0),
          miningRate: Number(user.mining_rate || 0.00025),
          referredBy: user.referred_by ? String(user.referred_by) : null,
          channelJoined: Boolean(user.channel_joined),
          groupJoined: Boolean(user.group_joined),
          twitterJoined: Boolean(user.twitter_joined),
          lastTwitterTask: user.last_twitter_task || null,
          lastTelegramTask: user.last_telegram_task || null,
          checkinStreak: Number(user.checkin_streak || 0),
          lastCheckinDate: user.last_checkin_date || null,
          lastClaim: user.last_claim || null,
          country: user.country || 'Unknown',
        },
        telegram: {
          id: telegram.user.id,
          firstName: telegram.user.first_name || '',
          lastName: telegram.user.last_name || '',
          username: telegram.user.username || '',
          languageCode: telegram.user.language_code || '',
        },
        startParam: telegram.startParam,
      },
      {
        status: 200,
        headers: {
          'Cache-Control': 'no-store',
        },
      }
    );
  } catch (error) {
    const message =
      error instanceof Error ? error.message : 'Unknown authentication error';

    const isAuthError =
      message.includes('Telegram') ||
      message.includes('BOT_TOKEN') ||
      message.includes('Expired');

    if (!isAuthError) {
      console.error('Bootstrap API error:', message);
    }

    return NextResponse.json(
      {
        error: isAuthError
          ? 'Invalid Telegram authentication'
          : 'Internal server error',
      },
      {
        status: isAuthError ? 401 : 500,
        headers: {
          'Cache-Control': 'no-store',
        },
      }
    );
  }
}

