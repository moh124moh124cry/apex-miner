import { supabaseAdmin } from './supabase-admin';

const NOTIFICATION_BATCH_SIZE = 25;
const TELEGRAM_SEND_DELAY_MS = 80;
const MAX_NOTIFICATION_ATTEMPTS = 3;

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function getAppUrl() {
  const raw =
    process.env.NEXT_PUBLIC_APP_URL;

  if (!raw) {
    throw new Error(
      'Missing NEXT_PUBLIC_APP_URL'
    );
  }

  const url = new URL(raw);

  if (url.protocol !== 'https:') {
    throw new Error(
      'NEXT_PUBLIC_APP_URL must use HTTPS'
    );
  }

  url.hash = '';
  return url;
}

function buildAppLink(appUrl, params) {
  const url = new URL(
    appUrl.toString()
  );

  Object.entries(params).forEach(
    ([key, value]) => {
      url.searchParams.set(
        key,
        String(value)
      );
    }
  );

  return url.toString();
}

function buildNotification(kind, appUrl) {
  if (kind === 'mining_finished') {
    return {
      text:
        '⛏️ Your APXN mining session has ended.\n\n' +
        'Restart mining now to continue earning APXN POINTS.',
      buttonText:
        '⛏️ Restart Mining',
      buttonUrl:
        buildAppLink(
          appUrl,
          { tab: 'mine' }
        ),
    };
  }

  if (kind === 'daily_reward') {
    return {
      text:
        '🎁 Your daily APXN reward is available!\n\n' +
        'Open Apex Network and claim your Daily Check-In reward.',
      buttonText:
        '🎁 Claim Daily Reward',
      buttonUrl:
        buildAppLink(
          appUrl,
          {
            tab: 'tasks',
            action: 'checkin',
          }
        ),
    };
  }

  if (kind === 'stars_10k_offer') {
    return {
      text:
        '⚡ 10,000 APXN POINTS Boost is available!\n\n' +
        '⭐ Price: 10 Telegram Stars\n' +
        '⏱ Duration: 48 Hours\n' +
        '⛏ Reward: 10,000 APXN POINTS\n\n' +
        'Your 10,000 APXN POINTS are mined progressively during the 48-hour boost. ' +
        'Free mining and ad mining remain active.',
      buttonText:
        '⚡ Activate 10,000 APXN — ⭐10',
      buttonUrl:
        buildAppLink(
          appUrl,
          {
            tab: 'mine',
            offer: 'stars48',
          }
        ),
    };
  }

  return null;
}

async function telegramCall(
  botToken,
  method,
  payload
) {
  const response = await fetch(
    `https://api.telegram.org/bot${botToken}/${method}`,
    {
      method: 'POST',
      headers: {
        'content-type':
          'application/json',
      },
      body:
        JSON.stringify(payload),
    }
  );

  let data = null;

  try {
    data =
      await response.json();
  } catch {
  }

  if (
    response.ok &&
    data?.ok === true
  ) {
    return {
      ok: true,
      result:
        data.result,
    };
  }

  return {
    ok: false,
    errorCode:
      Number(
        data?.error_code ||
          response.status ||
          0
      ),
    description:
      String(
        data?.description ||
          'Telegram API error'
      ),
    retryAfter:
      Math.max(
        0,
        Number(
          data?.parameters?.retry_after ||
            0
        )
      ),
  };
}

function notificationStillValid(
  notification,
  user,
  now
) {
  if (!user) {
    return false;
  }

  if (notification.kind === 'mining_finished') {
    const endsAt =
      user.mining_session_ends_at
        ? new Date(
            user.mining_session_ends_at
          ).getTime()
        : 0;

    return (
      Number.isFinite(endsAt) &&
      endsAt > 0 &&
      endsAt <= now.getTime()
    );
  }

  if (notification.kind === 'daily_reward') {
    const today =
      now
        .toISOString()
        .slice(0, 10);

    const lastCheckin =
      String(
        user.last_checkin_date ||
          ''
      ).slice(0, 10);

    const rewardEligible =
      !user.daily_checkin_v2_enabled ||
      Number(
        user.checkin_recovery_days ??
          2
      ) >= 2;

    return (
      lastCheckin !== today &&
      rewardEligible
    );
  }

  if (notification.kind === 'stars_10k_offer') {
    const boostUntil =
      user.stars_boost_until
        ? new Date(
            user.stars_boost_until
          ).getTime()
        : 0;

    return !(
      Number.isFinite(boostUntil) &&
      boostUntil > now.getTime()
    );
  }

  return false;
}

async function markNotification(
  id,
  patch
) {
  const {
    error,
  } =
    await supabaseAdmin
      .from(
        'telegram_notifications'
      )
      .update(patch)
      .eq('id', id);

  if (error) {
    console.error(
      'Notification status update failed:',
      error.code
    );
  }
}

async function prepareNotifications() {
  const {
    error,
  } =
    await supabaseAdmin.rpc(
      'apex_prepare_telegram_notifications',
      {
        p_limit_per_kind: 40,
      }
    );

  if (error) {
    throw new Error(
      `Notification preparation failed: ${error.code}`
    );
  }
}

async function loadPending() {
  const {
    data,
    error,
  } =
    await supabaseAdmin
      .from(
        'telegram_notifications'
      )
      .select(
        'id,telegram_id,kind,dedupe_key,attempts,priority,created_at'
      )
      .eq(
        'status',
        'pending'
      )
      .lte(
        'scheduled_at',
        new Date().toISOString()
      )
      .order(
        'priority',
        {
          ascending: true,
        }
      )
      .order(
        'created_at',
        {
          ascending: true,
        }
      )
      .limit(
        NOTIFICATION_BATCH_SIZE
      );

  if (error) {
    throw new Error(
      `Pending notification lookup failed: ${error.code}`
    );
  }

  return data || [];
}

async function loadUsers(notifications) {
  const ids = [
    ...new Set(
      notifications.map(
        item =>
          String(
            item.telegram_id
          )
      )
    ),
  ];

  if (ids.length === 0) {
    return new Map();
  }

  const {
    data,
    error,
  } =
    await supabaseAdmin
      .from('users')
      .select(
        [
          'telegram_id',
          'mining_session_ends_at',
          'last_checkin_date',
          'daily_checkin_v2_enabled',
          'checkin_recovery_days',
          'stars_boost_until',
        ].join(',')
      )
      .in(
        'telegram_id',
        ids
      );

  if (error) {
    throw new Error(
      `Notification user refresh failed: ${error.code}`
    );
  }

  return new Map(
    (data || []).map(
      user => [
        String(
          user.telegram_id
        ),
        user,
      ]
    )
  );
}

export async function processTelegramNotifications() {
  const botToken =
    process.env.BOT_TOKEN;

  if (!botToken) {
    throw new Error(
      'Missing BOT_TOKEN'
    );
  }

  const appUrl =
    getAppUrl();

  await prepareNotifications();

  const notifications =
    await loadPending();

  if (notifications.length === 0) {
    return {
      ok: true,
      sent: 0,
      cancelled: 0,
      blocked: 0,
      failed: 0,
    };
  }

  const users =
    await loadUsers(
      notifications
    );

  const now =
    new Date();

  let sent = 0;
  let cancelled = 0;
  let blocked = 0;
  let failed = 0;

  for (
    const notification
    of notifications
  ) {
    const user =
      users.get(
        String(
          notification.telegram_id
        )
      );

    if (
      !notificationStillValid(
        notification,
        user,
        now
      )
    ) {
      await markNotification(
        notification.id,
        {
          status:
            'cancelled',
          last_error:
            'Notification no longer applicable',
        }
      );

      cancelled += 1;
      continue;
    }

    const message =
      buildNotification(
        notification.kind,
        appUrl
      );

    if (!message) {
      await markNotification(
        notification.id,
        {
          status:
            'failed',
          last_error:
            'Unknown notification kind',
        }
      );

      failed += 1;
      continue;
    }

    const result =
      await telegramCall(
        botToken,
        'sendMessage',
        {
          chat_id:
            notification.telegram_id,
          text:
            message.text,
          disable_web_page_preview:
            true,
          reply_markup: {
            inline_keyboard: [
              [
                {
                  text:
                    message.buttonText,
                  web_app: {
                    url:
                      message.buttonUrl,
                  },
                },
              ],
            ],
          },
        }
      );

    if (result.ok) {
      await markNotification(
        notification.id,
        {
          status: 'sent',
          sent_at:
            new Date()
              .toISOString(),
          telegram_message_id:
            result.result?.message_id ||
            null,
          last_error:
            null,
        }
      );

      sent += 1;
    } else if (
      result.errorCode === 403 ||
      result.errorCode === 400
    ) {
      await markNotification(
        notification.id,
        {
          status:
            'blocked',
          attempts:
            Number(
              notification.attempts ||
                0
            ) + 1,
          last_error:
            result.description.slice(
              0,
              500
            ),
        }
      );

      blocked += 1;
    } else {
      const attempts =
        Number(
          notification.attempts ||
            0
        ) + 1;

      const retrySeconds =
        result.retryAfter > 0
          ? result.retryAfter
          : 30 * 60;

      await markNotification(
        notification.id,
        {
          status:
            attempts >=
            MAX_NOTIFICATION_ATTEMPTS
              ? 'failed'
              : 'pending',
          attempts,
          scheduled_at:
            new Date(
              Date.now() +
                retrySeconds *
                  1000
            ).toISOString(),
          last_error:
            result.description.slice(
              0,
              500
            ),
        }
      );

      failed += 1;

      if (
        result.errorCode === 429
      ) {
        break;
      }
    }

    await sleep(
      TELEGRAM_SEND_DELAY_MS
    );
  }

  return {
    ok: true,
    sent,
    cancelled,
    blocked,
    failed,
  };
}

