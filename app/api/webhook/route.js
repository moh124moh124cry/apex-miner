import { Telegraf } from 'telegraf';
import { NextResponse } from 'next/server';
import crypto from 'crypto';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const bot = new Telegraf(process.env.BOT_TOKEN);

// ======================================================
// Moderation configuration
// ======================================================

// Exact/partial official link prefixes that normal members may share.
// Example:
// ALLOWED_LINK_PREFIXES=https://apxn.network,https://t.me/ApexMiner_Official
const allowedLinkPrefixes = (process.env.ALLOWED_LINK_PREFIXES || '')
  .split(',')
  .map((value) => value.trim().toLowerCase())
  .filter(Boolean);

// Optional whole-domain whitelist.
// Be careful: allowing "t.me" allows every Telegram invite/link.
// Example:
// ALLOWED_LINK_DOMAINS=apxn.network
const allowedLinkDomains = (process.env.ALLOWED_LINK_DOMAINS || '')
  .split(',')
  .map((domain) =>
    domain
      .trim()
      .toLowerCase()
      .replace(/^https?:\/\//, '')
      .replace(/^www\./, '')
      .replace(/\/$/, '')
  )
  .filter(Boolean);

// Optional additional spam phrases, comma-separated.
const extraSpamKeywords = (process.env.SPAM_KEYWORDS || '')
  .split(',')
  .map((value) => value.trim().toLowerCase())
  .filter(Boolean);

// Other bots are NOT blocked by default.
// Enable only if you do not use legitimate third-party bots in the group.
const blockOtherBots =
  process.env.BLOCK_OTHER_BOTS === 'true';

const FLOOD_WINDOW_MS = 10_000;
const FLOOD_MAX_MESSAGES = 6;

const REPEAT_WINDOW_MS = 60_000;
const REPEAT_MAX_SAME_MESSAGE = 3;

const VIOLATION_WINDOW_MS = 10 * 60_000;
const VIOLATIONS_BEFORE_MUTE = 3;

const MUTE_SECONDS = 10 * 60;
const ADMIN_CACHE_MS = 5 * 60_000;

// ======================================================
// Lightweight in-memory moderation state
//
// This intentionally avoids Supabase/database writes.
// On serverless deployments, memory is best-effort and may reset
// between instances. Link/spam deletion remains stateless and reliable.
// ======================================================
const floodState = new Map();
const repeatState = new Map();
const violationState = new Map();
const adminCache = new Map();

function now() {
  return Date.now();
}

function userKey(ctx) {
  return `${ctx.chat?.id || 'unknown'}:${ctx.from?.id || 'unknown'}`;
}

function cleanupMap(map, maxAgeMs) {
  const cutoff = now() - maxAgeMs;

  for (const [key, value] of map.entries()) {
    const timestamp =
      typeof value === 'number'
        ? value
        : value?.updatedAt || value?.expiresAt || 0;

    if (timestamp < cutoff) {
      map.delete(key);
    }
  }
}

// ======================================================
// Text / URL helpers
// ======================================================

function getMessageText(message) {
  return (message?.text || message?.caption || '').trim();
}

function getMessageEntities(message) {
  return [
    ...(message?.entities || []),
    ...(message?.caption_entities || []),
  ];
}

function normalizeText(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

// ======================================================
// Extract every link surface from a Telegram message
//
// Includes:
// - visible text URLs
// - caption URLs
// - url entities
// - text_link entities
// - inline keyboard URL buttons
// - login_url buttons
// - web_app buttons
// ======================================================

function extractUrls(message) {
  const found = new Set();

  const sources = [
    {
      text: message?.text || '',
      entities: message?.entities || [],
    },
    {
      text: message?.caption || '',
      entities: message?.caption_entities || [],
    },
  ];

  const patterns = [
    /https?:\/\/[^\s<>()]+/gi,
    /www\.[^\s<>()]+/gi,
    /(?:t\.me|telegram\.me)\/[^\s<>()]+/gi,
    /tg:\/\/[^\s<>()]+/gi,
    /\b(?:[a-z0-9-]+\.)+[a-z]{2,}(?:\/[^\s<>()]*)?/gi,
  ];

  for (const source of sources) {
    const text = source.text;

    for (const pattern of patterns) {
      const matches =
        text.match(pattern) || [];

      for (const match of matches) {
        found.add(
          match.replace(
            /[),.;!?]+$/g,
            ''
          )
        );
      }
    }

    for (const entity of source.entities) {
      // Hidden clickable text:
      // Example: "Click here" -> https://example.com
      if (
        entity.type === 'text_link' &&
        entity.url
      ) {
        found.add(entity.url);
      }

      // Telegram URL entity.
      // JS string slicing uses UTF-16 code units,
      // which matches Telegram entity offsets.
      if (
        entity.type === 'url' &&
        Number.isInteger(entity.offset) &&
        Number.isInteger(entity.length)
      ) {
        const entityUrl =
          text.slice(
            entity.offset,
            entity.offset +
              entity.length
          );

        if (entityUrl) {
          found.add(entityUrl);
        }
      }
    }
  }

  // ====================================================
  // Inline keyboard buttons
  //
  // This is the important fix for advertisements such as:
  // photo + BINANCE / AIRDROP / CLAIM buttons.
  // ====================================================

  const inlineKeyboard =
    message?.reply_markup
      ?.inline_keyboard || [];

  for (const row of inlineKeyboard) {
    if (!Array.isArray(row)) {
      continue;
    }

    for (const button of row) {
      if (!button) {
        continue;
      }

      // Standard URL button
      if (button.url) {
        found.add(button.url);
      }

      // Telegram login button containing an external URL
      if (button.login_url?.url) {
        found.add(
          button.login_url.url
        );
      }

      // Telegram Web App button
      if (button.web_app?.url) {
        found.add(
          button.web_app.url
        );
      }
    }
  }

  return [
    ...found,
  ].filter(Boolean);
}

function normalizeUrl(rawUrl) {
  const value =
    String(rawUrl || '').trim();

  if (!value) {
    return null;
  }

  if (
    value
      .toLowerCase()
      .startsWith('tg://')
  ) {
    return value.toLowerCase();
  }

  try {
    const normalized =
      /^https?:\/\//i.test(value)
        ? value
        : `https://${value}`;

    return new URL(normalized);
  } catch {
    return null;
  }
}

function isAllowedUrl(rawUrl) {
  const lowerRaw =
    String(rawUrl || '')
      .trim()
      .toLowerCase();

  // Exact/partial official link prefix whitelist.
  if (
    allowedLinkPrefixes.some(
      (prefix) =>
        lowerRaw.startsWith(prefix)
    )
  ) {
    return true;
  }

  const parsed =
    normalizeUrl(rawUrl);

  if (
    !parsed ||
    typeof parsed === 'string'
  ) {
    return false;
  }

  const hostname =
    parsed.hostname
      .toLowerCase()
      .replace(/^www\./, '');

  return allowedLinkDomains.some(
    (domain) =>
      hostname === domain ||
      hostname.endsWith(
        `.${domain}`
      )
  );
}

function containsUnauthorizedLink(
  message
) {
  const urls =
    extractUrls(message);

  if (urls.length === 0) {
    return false;
  }

  // If no whitelist exists, normal members may not post links.
  if (
    allowedLinkPrefixes.length ===
      0 &&
    allowedLinkDomains.length ===
      0
  ) {
    return true;
  }

  return urls.some(
    (url) => !isAllowedUrl(url)
  );
}

// ======================================================
// Spam heuristics
// ======================================================

const defaultSpamKeywords = [
  'guaranteed profit',
  'guaranteed returns',
  'double your money',
  'double your crypto',
  'investment opportunity',
  'send crypto',
  'send usdt',
  'send bnb',
  'dm me for profit',
  'contact me privately',
  'claim free crypto',
  'free usdt',
  'free bnb',
  'wallet recovery',
  'seed phrase',
  'private key',
  'ارباح مضمونة',
  'أرباح مضمونة',
  'ضاعف اموالك',
  'ضاعف أموالك',
  'ارسل usdt',
  'أرسل usdt',
  'ارسل bnb',
  'أرسل bnb',
  'تواصل معي خاص',
  'راسلني خاص',
];

const spamKeywords = [
  ...defaultSpamKeywords,
  ...extraSpamKeywords,
];

function countMentions(message) {
  return getMessageEntities(
    message
  ).filter(
    (entity) =>
      entity.type === 'mention' ||
      entity.type ===
        'text_mention'
  ).length;
}

function looksLikeSpam(message) {
  const text = normalizeText(
    getMessageText(message)
  );

  if (!text) {
    return false;
  }

  const keywordHit =
    spamKeywords.some(
      (keyword) =>
        text.includes(keyword)
    );

  if (keywordHit) {
    return true;
  }

  // Mass tagging is usually promotional/flood behavior.
  if (
    countMentions(message) >= 5
  ) {
    return true;
  }

  // Extremely repeated promotional symbols / characters.
  if (/(.)\1{14,}/u.test(text)) {
    return true;
  }

  return false;
}

// ======================================================
// Flood / duplicate-message detection
// ======================================================

function isFlooding(ctx) {
  const key = userKey(ctx);
  const timestamp = now();

  const current =
    floodState.get(key) || {
      timestamps: [],
      updatedAt: timestamp,
    };

  current.timestamps =
    current.timestamps.filter(
      (item) =>
        timestamp - item <=
        FLOOD_WINDOW_MS
    );

  current.timestamps.push(
    timestamp
  );

  current.updatedAt =
    timestamp;

  floodState.set(
    key,
    current
  );

  return (
    current.timestamps.length >
    FLOOD_MAX_MESSAGES
  );
}

function isRepeatedMessage(ctx) {
  const text = normalizeText(
    getMessageText(ctx.message)
  );

  // Ignore tiny messages such as "hi", emojis, etc.
  if (text.length < 8) {
    return false;
  }

  const key = userKey(ctx);
  const timestamp = now();

  const current =
    repeatState.get(key) || {
      text,
      count: 0,
      firstAt: timestamp,
      updatedAt: timestamp,
    };

  if (
    current.text !== text ||
    timestamp -
      current.firstAt >
      REPEAT_WINDOW_MS
  ) {
    repeatState.set(key, {
      text,
      count: 1,
      firstAt: timestamp,
      updatedAt: timestamp,
    });

    return false;
  }

  current.count += 1;
  current.updatedAt =
    timestamp;

  repeatState.set(
    key,
    current
  );

  return (
    current.count >=
    REPEAT_MAX_SAME_MESSAGE
  );
}

// ======================================================
// Admin check with short cache
// ======================================================

async function isAdmin(ctx) {
  try {
    if (
      !ctx.chat?.id ||
      !ctx.from?.id
    ) {
      return false;
    }

    const key =
      userKey(ctx);

    const cached =
      adminCache.get(key);

    if (
      cached &&
      cached.expiresAt > now()
    ) {
      return cached.isAdmin;
    }

    const member =
      await ctx.telegram
        .getChatMember(
          ctx.chat.id,
          ctx.from.id
        );

    const result =
      member.status ===
        'creator' ||
      member.status ===
        'administrator';

    adminCache.set(key, {
      isAdmin: result,
      expiresAt:
        now() +
        ADMIN_CACHE_MS,
    });

    return result;
  } catch (error) {
    console.error(
      'Admin check error:',
      error
    );

    // Fail-safe: do not punish someone if Telegram
    // cannot confirm their role.
    return true;
  }
}

// ======================================================
// Moderation actions
// ======================================================

async function safeDelete(ctx) {
  try {
    await ctx.deleteMessage();

    return true;
  } catch (error) {
    console.error(
      'Delete message error:',
      error
    );

    return false;
  }
}

async function muteUser(
  ctx,
  seconds = MUTE_SECONDS
) {
  try {
    if (
      !ctx.chat?.id ||
      !ctx.from?.id
    ) {
      return false;
    }

    const untilDate =
      Math.floor(
        Date.now() / 1000
      ) + seconds;

    await ctx.telegram.callApi(
      'restrictChatMember',
      {
        chat_id:
          ctx.chat.id,

        user_id:
          ctx.from.id,

        permissions: {
          can_send_messages:
            false,

          can_send_audios:
            false,

          can_send_documents:
            false,

          can_send_photos:
            false,

          can_send_videos:
            false,

          can_send_video_notes:
            false,

          can_send_voice_notes:
            false,

          can_send_polls:
            false,

          can_send_other_messages:
            false,

          can_add_web_page_previews:
            false,

          can_change_info:
            false,

          can_invite_users:
            false,

          can_pin_messages:
            false,

          can_manage_topics:
            false,
        },

        use_independent_chat_permissions:
          true,

        until_date:
          untilDate,
      }
    );

    return true;
  } catch (error) {
    console.error(
      'Mute user error:',
      error
    );

    return false;
  }
}

function recordViolation(ctx) {
  const key =
    userKey(ctx);

  const timestamp =
    now();

  const current =
    violationState.get(key) || {
      timestamps: [],
      updatedAt: timestamp,
    };

  current.timestamps =
    current.timestamps.filter(
      (item) =>
        timestamp - item <=
        VIOLATION_WINDOW_MS
    );

  current.timestamps.push(
    timestamp
  );

  current.updatedAt =
    timestamp;

  violationState.set(
    key,
    current
  );

  return (
    current.timestamps.length
  );
}

async function moderateViolation(
  ctx,
  reason,
  forceMute = false
) {
  if (await isAdmin(ctx)) {
    return;
  }

  await safeDelete(ctx);

  const violations =
    recordViolation(ctx);

  if (
    forceMute ||
    violations >=
      VIOLATIONS_BEFORE_MUTE
  ) {
    await muteUser(ctx);
  }

  console.log(
    `Moderation: ${reason}; chat=${ctx.chat?.id}; user=${ctx.from?.id}; violations=${violations}`
  );
}

// ======================================================
// Bot commands
// ======================================================

bot.command(
  'start',
  async (ctx) => {
    try {
      const appUrl =
        process.env
          .NEXT_PUBLIC_APP_URL;

      if (!appUrl) {
        await ctx.reply(
          'Welcome to ApexMiner! 🚀'
        );

        return;
      }

      await ctx.reply(
        'Welcome to ApexMiner! 🚀\n\n' +
          'Start mining APXN points directly from Telegram. ' +
          'Click below to open your mining dashboard.',
        {
          reply_markup: {
            inline_keyboard: [
              [
                {
                  text:
                    'Start Mining ⛏️',

                  web_app: {
                    url:
                      appUrl,
                  },
                },
              ],
            ],
          },
        }
      );
    } catch (error) {
      console.error(
        'Start command error:',
        error
      );
    }
  }
);

bot.command(
  'rules',
  async (ctx) => {
    try {
      await ctx.reply(
        '📌 Apex Network Community Rules\n\n' +
          '1. No spam or repeated messages.\n' +
          '2. No unauthorized links or advertisements.\n' +
          '3. Never share seed phrases or private keys.\n' +
          '4. Respect members and moderators.\n' +
          '5. Official admins will never ask for your wallet private key.'
      );
    } catch (error) {
      console.error(
        'Rules command error:',
        error
      );
    }
  }
);

// ======================================================
// Welcome new members
// ======================================================

bot.on(
  'new_chat_members',
  async (ctx) => {
    try {
      const members =
        ctx.message
          ?.new_chat_members ||
        [];

      const humanMembers =
        members.filter(
          (member) =>
            !member.is_bot
        );

      if (
        humanMembers.length ===
        0
      ) {
        return;
      }

      const names =
        humanMembers.map(
          (member) => {
            const name = [
              member.first_name,
              member.last_name,
            ]
              .filter(Boolean)
              .join(' ');

            return (
              name ||
              'New member'
            );
          }
        );

      await ctx.reply(
        `👋 Welcome ${names.join(
          ' and '
        )}!\n\n` +
          'Welcome to the Apex Network community 🚀\n' +
          'Please respect the community rules.\n\n' +
          '🔒 Never share your seed phrase or private key.\n' +
          '📌 Unauthorized links, advertising, and spam are automatically removed.\n\n' +
          'Use /rules to view the community rules.'
      );
    } catch (error) {
      console.error(
        'Welcome message error:',
        error
      );
    }
  }
);

// ======================================================
// Group moderation
// ======================================================

bot.on(
  'message',
  async (ctx) => {
    try {
      const chatType =
        ctx.chat?.type;

      if (
        chatType !== 'group' &&
        chatType !==
          'supergroup'
      ) {
        return;
      }

      const message =
        ctx.message;

      if (
        !message ||
        !ctx.from
      ) {
        return;
      }

      // Optional protection from third-party bots.
      if (
        blockOtherBots &&
        ctx.from.is_bot
      ) {
        await moderateViolation(
          ctx,
          'OTHER_BOT',
          true
        );

        return;
      }

      // Unauthorized links are removed immediately.
      //
      // This now also checks links hidden in
      // inline keyboard buttons.
      if (
        containsUnauthorizedLink(
          message
        )
      ) {
        await moderateViolation(
          ctx,
          'UNAUTHORIZED_LINK'
        );

        return;
      }

      // High-confidence spam phrases / mass mentions.
      if (
        looksLikeSpam(
          message
        )
      ) {
        await moderateViolation(
          ctx,
          'SPAM_CONTENT'
        );

        return;
      }

      // Same message repeated several times.
      if (
        isRepeatedMessage(ctx)
      ) {
        await moderateViolation(
          ctx,
          'REPEATED_MESSAGE',
          true
        );

        return;
      }

      // Too many messages in a short period.
      if (isFlooding(ctx)) {
        await moderateViolation(
          ctx,
          'FLOOD',
          true
        );

        return;
      }
    } catch (error) {
      console.error(
        'Moderation error:',
        error
      );
    } finally {
      // Periodic lightweight cleanup.
      if (
        Math.random() <
        0.02
      ) {
        cleanupMap(
          floodState,
          FLOOD_WINDOW_MS *
            3
        );

        cleanupMap(
          repeatState,
          REPEAT_WINDOW_MS *
            3
        );

        cleanupMap(
          violationState,
          VIOLATION_WINDOW_MS *
            2
        );

        const timestamp =
          now();

        for (
          const [
            key,
            value,
          ] of adminCache.entries()
        ) {
          if (
            value.expiresAt <
            timestamp
          ) {
            adminCache.delete(
              key
            );
          }
        }
      }
    }
  }
);

// ======================================================
// Global Telegraf error handler
// ======================================================

bot.catch(
  (error, ctx) => {
    console.error(
      'Telegram bot error:',
      error,
      'update:',
      ctx?.update?.update_id
    );
  }
);

// ======================================================
// Secure webhook helper
// ======================================================

function safeEqualSecret(
  received,
  expected
) {
  if (
    !received ||
    !expected
  ) {
    return false;
  }

  const receivedBuffer =
    Buffer.from(received);

  const expectedBuffer =
    Buffer.from(expected);

  if (
    receivedBuffer.length !==
    expectedBuffer.length
  ) {
    return false;
  }

  return crypto.timingSafeEqual(
    receivedBuffer,
    expectedBuffer
  );
}

// ======================================================
// Telegram Webhook
// ======================================================

export async function POST(
  req
) {
  try {
    const webhookSecret =
      process.env
        .TELEGRAM_WEBHOOK_SECRET ||
      '';

    // Protection activates only after you configure
    // TELEGRAM_WEBHOOK_SECRET in Vercel and register
    // the same secret with Telegram's setWebhook.
    if (webhookSecret) {
      const receivedSecret =
        req.headers.get(
          'x-telegram-bot-api-secret-token'
        ) || '';

      if (
        !safeEqualSecret(
          receivedSecret,
          webhookSecret
        )
      ) {
        return NextResponse.json(
          {
            error:
              'Unauthorized',
          },
          {
            status: 401,
          }
        );
      }
    }

    const body =
      await req.json();

    await bot.handleUpdate(
      body
    );

    return NextResponse.json(
      {
        message: 'Success',
      },
      {
        status: 200,
      }
    );
  } catch (error) {
    console.error(
      'Webhook Error:',
      error
    );

    return NextResponse.json(
      {
        error:
          'Failed to process request',
      },
      {
        status: 500,
      }
    );
  }
}

// ======================================================
// Health check
// ======================================================

export async function GET() {
  return NextResponse.json({
    ok: true,
    service:
      'Apex Telegram Bot',
    moderation: true,
  });
}
