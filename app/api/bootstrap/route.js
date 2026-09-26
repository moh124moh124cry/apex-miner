import { NextResponse } from 'next/server';
import { env } from 'cloudflare:workers';
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

// Detect country from the same Cloudflare / Vercel sources
// as registration. Country is informational only.
function getCountryCode(request) {
  const candidates = [
    request.cf?.country,
    request.headers.get('cf-ipcountry'),
    request.headers.get('x-vercel-ip-country'),
  ];

  for (const rawCountry of candidates) {
    const country = String(rawCountry || '')
      .trim()
      .toUpperCase();

    if (
      /^[A-Z]{2}$/.test(country) &&
      country !== 'XX' &&
      country !== 'EU' &&
      country !== 'T1'
    ) {
      return country;
    }
  }

  return null;
}

// Daily social links come from Cloudflare WORKER RUNTIME variables,
// never from NEXT_PUBLIC_* values inlined into the browser build.
// These are public URLs; invalid or unconfigured links stay hidden.
function safeDailyTaskLink(value, allowedHosts) {
  if (typeof value !== 'string' || !value.trim()) {
    return '';
  }

  try {
    const link = new URL(value.trim());
    if (
      link.protocol !== 'https:' ||
      !allowedHosts.includes(link.hostname.toLowerCase()) ||
      link.username ||
      link.password
    ) {
      return '';
    }

    return link.href;
  } catch {
    return '';
  }
}

function getDailyTaskLinks() {
  return {
    telegram: safeDailyTaskLink(
      env.NEXT_PUBLIC_DAILY_TELEGRAM_LINK,
      ['t.me', 'telegram.me', 'www.t.me']
    ),
    twitter: safeDailyTaskLink(
      env.NEXT_PUBLIC_DAILY_TWITTER_LINK,
      ['x.com', 'www.x.com', 'twitter.com', 'www.twitter.com']
    ),
  };
}

async function getMiningEventState() {
  const { data, error } = await supabaseAdmin.rpc(
    'apex_mining_event_state'
  );

  if (error) {
    console.error(
      'Mining event state RPC error:',
      error.code
    );

    throw new Error('Mining event state unavailable');
  }

  const result = Array.isArray(data)
    ? data[0]
    : data;

  if (!result) {
    throw new Error('Invalid mining event state');
  }

  const serverNow =
    result.server_now || null;

  const startsAt =
    result.starts_at || null;

  const endsAt =
    result.ends_at || null;

  const serverNowTime =
    serverNow
      ? new Date(serverNow).getTime()
      : NaN;

  const startsAtTime =
    startsAt
      ? new Date(startsAt).getTime()
      : NaN;

  let secondsUntilStart = 0;

  if (
    !Boolean(result.active) &&
    Number.isFinite(serverNowTime) &&
    Number.isFinite(startsAtTime) &&
    startsAtTime > serverNowTime
  ) {
    secondsUntilStart = Math.max(
      1,
      Math.ceil(
        (startsAtTime - serverNowTime) /
          1000
      )
    );
  }

  return {
    serverNow,
    active: Boolean(result.active),
    startsAt,
    endsAt,

    remainingSeconds: Math.max(
      0,
      Number(
        result.remaining_seconds || 0
      )
    ),

    secondsUntilStart,

    baseRate: Number(
      result.base_rate || 0.02
    ),

    boostEnabled:
      Boolean(result.boost_enabled),
  };
}

export async function POST(request) {
  try {
    const body = await request.json();

    const initData =
      body?.initData;

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

    if (initData.length > 8192) {
      return response(
        {
          error:
            'Invalid Telegram init data',
        },
        400
      );
    }

    const telegram =
      validateTelegramInitData(
        initData
      );

    const telegramId =
      String(telegram.user.id);

    /*
     * IMPORTANT:
     *
     * Event timing comes from Supabase/Postgres.
     * The phone clock is not authoritative.
     */
    const miningEvent =
      await getMiningEventState();

    const {
      data: user,
      error,
    } = await supabaseAdmin
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
        last_twitter_task_at,
        last_telegram_task_at,
        checkin_streak,
        active_days,
        checkin_recovery_days,
        daily_checkin_v2_enabled,
        last_checkin_date,
        last_claim,
        mining_session_ends_at,
        country,
        last_ad_reward_at,
        ad_reward_count,
        mining_boost_started_at,
        mining_boost_until,
        mining_boost_count
      `)
      .eq(
        'telegram_id',
        telegramId
      )
      .maybeSingle();

    if (error) {
      console.error(
        'Bootstrap database error:',
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

    if (!user) {
      return response({
        success: true,
        exists: false,

        miningEvent,

        dailyTaskLinks: getDailyTaskLinks(),

        telegram: {
          id:
            telegram.user.id,

          firstName:
            telegram.user
              .first_name || '',

          lastName:
            telegram.user
              .last_name || '',

          username:
            telegram.user
              .username || '',

          languageCode:
            telegram.user
              .language_code || '',
        },

        startParam:
          telegram.startParam,
      });
    }

    // For existing users whose country was not saved before
    // the Cloudflare migration fix, fill the NULL country once
    // on their next authenticated app open. Never overwrite a
    // populated country, including if two app opens race.
    // No additional database write for the vast majority of
    // users who already have their country recorded.
    let resolvedCountry = user.country || null;

    if (!resolvedCountry) {
      const detectedCountry = getCountryCode(request);

      if (detectedCountry) {
        const {
          data: savedCountry,
          error: countryError,
        } = await supabaseAdmin
          .from('users')
          .update({ country: detectedCountry })
          .eq('telegram_id', telegramId)
          .is('country', null)
          .select('country')
          .maybeSingle();

        if (countryError) {
          // Country is informational. Do not block mining
          // or the rest of the dashboard on a failed save.
          console.error(
            'Existing user country save error:',
            countryError.code
          );
        } else if (savedCountry?.country) {
          resolvedCountry = savedCountry.country;
        }
      }
    }

    return response({
      success: true,
      exists: true,

      /*
       * Authoritative event state.
       *
       * Current production event:
       * 16 Sep 2026 20:00 Algeria
       * ->
       * 18 Sep 2026 20:00 Algeria
       *
       * Actual dates remain controlled
       * by the Supabase RPC.
       */
      miningEvent,

      dailyTaskLinks: getDailyTaskLinks(),

      user: {
        telegramId:
          String(
            user.telegram_id
          ),

        firstName:
          user.first_name || '',

        username:
          user.username || '',

        balance:
          Number(
            user.balance || 0
          ),

        miningRate:
          Number(
            user.mining_rate ||
              0.00025
          ),

        referredBy:
          user.referred_by
            ? String(
                user.referred_by
              )
            : null,

        channelJoined:
          Boolean(
            user.channel_joined
          ),

        groupJoined:
          Boolean(
            user.group_joined
          ),

        twitterJoined:
          Boolean(
            user.twitter_joined
          ),

        lastTwitterTask:
          user.last_twitter_task ||
          null,

        lastTelegramTask:
          user.last_telegram_task ||
          null,

        lastTwitterTaskAt:
          user.last_twitter_task_at ||
          null,

        lastTelegramTaskAt:
          user.last_telegram_task_at ||
          null,

        checkinStreak:
          Number(
            user.checkin_streak || 0
          ),

        activeDays:
          Number(
            user.active_days ??
              user.checkin_streak ??
              0
          ),

        recoveryDays:
          Math.max(
            0,
            Math.min(
              2,
              Number(
                user.checkin_recovery_days ??
                  2
              )
            )
          ),

        dailyCheckinV2Enabled:
          Boolean(
            user.daily_checkin_v2_enabled
          ),

        lastCheckinDate:
          user.last_checkin_date ||
          null,

        lastClaim:
          user.last_claim || null,

        miningSessionEndsAt:
          user.mining_session_ends_at ||
          null,

        country:
          resolvedCountry ||
          'Unknown',

        lastAdRewardAt:
          user.last_ad_reward_at ||
          null,

        adRewardCount:
          Number(
            user.ad_reward_count ||
              0
          ),

        miningBoostStartedAt:
          user
            .mining_boost_started_at ||
          null,

        miningBoostUntil:
          user
            .mining_boost_until ||
          null,

        miningBoostCount:
          Number(
            user.mining_boost_count ||
              0
          ),
      },

      telegram: {
        id:
          telegram.user.id,

        firstName:
          telegram.user
            .first_name || '',

        lastName:
          telegram.user
            .last_name || '',

        username:
          telegram.user
            .username || '',

        languageCode:
          telegram.user
            .language_code || '',
      },

      startParam:
        telegram.startParam,
    });

  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : 'Unknown authentication error';

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
        'Bootstrap API error:',
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


