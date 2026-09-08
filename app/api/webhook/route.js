import { Telegraf } from 'telegraf';
import { NextResponse } from 'next/server';
import crypto from 'crypto';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const bot = new Telegraf(
  process.env.BOT_TOKEN
);

// ======================================================
// Moderation configuration
// ======================================================

// Exact official URL/path prefixes that normal members
// may share.
//
// Examples:
//
// https://apxn.network
//   allows:
//   https://apxn.network
//   https://apxn.network/
//   https://apxn.network/news
//
//   does NOT allow:
//   https://apxn.network.evil.com
//
// https://t.me/ApexMiner_Official
//   allows:
//   https://t.me/ApexMiner_Official
//   https://t.me/ApexMiner_Official/123
//
//   does NOT allow:
//   https://t.me/ApexMiner_OfficialFake
//
// Example env:
// ALLOWED_LINK_PREFIXES=https://apxn.network,https://t.me/ApexMiner_Official
const rawAllowedLinkPrefixes =
  (
    process.env
      .ALLOWED_LINK_PREFIXES ||
    ''
  )
    .split(',')
    .map(
      (value) =>
        value.trim()
    )
    .filter(Boolean);

// Optional whole-domain whitelist.
//
// Be careful:
// ALLOWED_LINK_DOMAINS=t.me
// would allow every t.me link.
//
// Example:
// ALLOWED_LINK_DOMAINS=apxn.network
const allowedLinkDomains =
  (
    process.env
      .ALLOWED_LINK_DOMAINS ||
    ''
  )
    .split(',')
    .map(
      normalizeAllowedDomain
    )
    .filter(Boolean);

// Optional additional spam phrases.
const extraSpamKeywords =
  (
    process.env
      .SPAM_KEYWORDS ||
    ''
  )
    .split(',')
    .map(
      (value) =>
        value
          .trim()
          .toLowerCase()
    )
    .filter(Boolean);

// Other bots are NOT blocked by default.
//
// Enable only if you do not use legitimate
// third-party bots in the group.
const blockOtherBots =
  process.env
    .BLOCK_OTHER_BOTS ===
  'true';

const FLOOD_WINDOW_MS =
  10_000;

const FLOOD_MAX_MESSAGES =
  6;

const REPEAT_WINDOW_MS =
  60_000;

const REPEAT_MAX_SAME_MESSAGE =
  3;

const VIOLATION_WINDOW_MS =
  10 * 60_000;

const VIOLATIONS_BEFORE_MUTE =
  3;

const MUTE_SECONDS =
  10 * 60;

const ADMIN_CACHE_MS =
  5 * 60_000;

// ======================================================
// Memory bounds
// ======================================================
//
// Vercel server memory is only a best-effort cache.
//
// It must NEVER become an unbounded store when the
// application grows.
//
// 10,000 entries per map is enough for hot-instance
// moderation while keeping memory bounded.
//
// When the limit is reached, the oldest entry is evicted.
// Link deletion itself remains stateless and unaffected.
// ======================================================

const MAX_MODERATION_STATE_ENTRIES =
  10_000;

// ======================================================
// Lightweight in-memory moderation state
//
// No Supabase/database writes are used for moderation.
//
// On serverless deployments memory may reset between
// instances. This is expected.
//
// The maps are performance/rate-control helpers only.
// ======================================================

const floodState =
  new Map();

const repeatState =
  new Map();

const violationState =
  new Map();

const adminCache =
  new Map();

function now() {
  return Date.now();
}

function userKey(ctx) {
  return `${
    ctx.chat?.id ||
    'unknown'
  }:${
    ctx.from?.id ||
    'unknown'
  }`;
}

function setBoundedMapEntry(
  map,
  key,
  value
) {
  // Refresh insertion order for active entries.
  map.delete(key);

  map.set(
    key,
    value
  );

  while (
    map.size >
    MAX_MODERATION_STATE_ENTRIES
  ) {
    const oldestKey =
      map
        .keys()
        .next()
        .value;

    if (
      oldestKey ===
      undefined
    ) {
      break;
    }

    map.delete(
      oldestKey
    );
  }
}

function cleanupMap(
  map,
  maxAgeMs
) {
  const cutoff =
    now() -
    maxAgeMs;

  for (
    const [
      key,
      value,
    ] of map.entries()
  ) {
    const timestamp =
      typeof value ===
      'number'
        ? value
        : value?.updatedAt ||
          value?.expiresAt ||
          0;

    if (
      timestamp <
      cutoff
    ) {
      map.delete(key);
    }
  }
}

// ======================================================
// Text helpers
// ======================================================

function getMessageText(
  message
) {
  return (
    message?.text ||
    message?.caption ||
    ''
  ).trim();
}

function getMessageEntities(
  message
) {
  return [
    ...(
      message?.entities ||
      []
    ),
    ...(
      message
        ?.caption_entities ||
      []
    ),
  ];
}

function normalizeText(
  text
) {
  return String(
    text ||
    ''
  )
    .toLowerCase()
    .replace(
      /\s+/g,
      ' '
    )
    .trim();
}

// ======================================================
// URL normalization
// ======================================================

function normalizeHostname(
  hostname
) {
  return String(
    hostname ||
    ''
  )
    .trim()
    .toLowerCase()
    .replace(
      /^www\./,
      ''
    )
    .replace(
      /\.$/,
      ''
    );
}

function normalizeUrl(
  rawUrl
) {
  const value =
    String(
      rawUrl ||
      ''
    ).trim();

  if (!value) {
    return null;
  }

  if (
    value
      .toLowerCase()
      .startsWith(
        'tg://'
      )
  ) {
    return value
      .toLowerCase();
  }

  try {
    const normalized =
      /^https?:\/\//i
        .test(value)
        ? value
        : `https://${value}`;

    return new URL(
      normalized
    );
  } catch {
    return null;
  }
}

// ======================================================
// Whole-domain whitelist parser
// ======================================================
//
// Only a hostname is retained.
//
// This prevents malformed configuration such as paths,
// credentials, query strings or ports from becoming part
// of a hostname comparison.
// ======================================================

function normalizeAllowedDomain(
  rawDomain
) {
  const value =
    String(
      rawDomain ||
      ''
    ).trim();

  if (!value) {
    return null;
  }

  try {
    const parsed =
      new URL(
        /^https?:\/\//i
          .test(value)
          ? value
          : `https://${value}`
      );

    const hostname =
      normalizeHostname(
        parsed.hostname
      );

    return (
      hostname ||
      null
    );
  } catch {
    return null;
  }
}

// ======================================================
// Prefix whitelist parser
// ======================================================
//
// Prefixes are converted into structured rules once at
// startup.
//
// Security comparison is performed using:
// - protocol
// - exact hostname
// - exact port
// - path boundary
//
// Never raw string startsWith().
// ======================================================

function createAllowedPrefixRule(
  rawPrefix
) {
  const value =
    String(
      rawPrefix ||
      ''
    ).trim();

  if (!value) {
    return null;
  }

  // Telegram deep links are not parsed as ordinary
  // HTTP URLs. Keep them as explicitly bounded raw rules.
  if (
    value
      .toLowerCase()
      .startsWith(
        'tg://'
      )
  ) {
    return {
      type:
        'telegram-deep-link',

      value:
        value
          .toLowerCase(),
    };
  }

  const parsed =
    normalizeUrl(
      value
    );

  if (
    !parsed ||
    typeof parsed ===
      'string'
  ) {
    return null;
  }

  const hostname =
    normalizeHostname(
      parsed.hostname
    );

  if (!hostname) {
    return null;
  }

  let pathname =
    (
      parsed.pathname ||
      '/'
    )
      .toLowerCase();

  // "/official/" and "/official" should represent the
  // same configured path boundary.
  if (
    pathname.length >
      1 &&
    pathname.endsWith(
      '/'
    )
  ) {
    pathname =
      pathname.replace(
        /\/+$/,
        ''
      );
  }

  return {
    type:
      'http',

    protocol:
      parsed.protocol
        .toLowerCase(),

    hostname,

    port:
      parsed.port ||
      '',

    pathname,
  };
}

const allowedLinkPrefixRules =
  rawAllowedLinkPrefixes
    .map(
      createAllowedPrefixRule
    )
    .filter(Boolean);

// ======================================================
// Safe prefix matching
// ======================================================

function pathMatchesPrefix(
  candidatePath,
  allowedPath
) {
  const candidate =
    (
      candidatePath ||
      '/'
    )
      .toLowerCase();

  const prefix =
    (
      allowedPath ||
      '/'
    )
      .toLowerCase();

  // A root URL prefix allows all paths on that exact
  // host/protocol/port.
  if (
    prefix ===
    '/'
  ) {
    return true;
  }

  // Exact path.
  if (
    candidate ===
    prefix
  ) {
    return true;
  }

  // Child path only.
  //
  // Example:
  // /ApexMiner_Official/123 -> allowed
  //
  // /ApexMiner_OfficialFake -> rejected
  return candidate
    .startsWith(
      `${prefix}/`
    );
}

function telegramDeepLinkMatches(
  rawUrl,
  ruleValue
) {
  const candidate =
    String(
      rawUrl ||
      ''
    )
      .trim()
      .toLowerCase();

  if (
    candidate ===
    ruleValue
  ) {
    return true;
  }

  if (
    !candidate
      .startsWith(
        ruleValue
      )
  ) {
    return false;
  }

  // Only accept a real structural boundary after
  // the configured deep-link prefix.
  const nextCharacter =
    candidate[
      ruleValue.length
    ];

  return [
    '/',
    '?',
    '#',
    '&',
  ].includes(
    nextCharacter
  );
}

function matchesAllowedPrefix(
  rawUrl,
  rule
) {
  if (
    rule.type ===
    'telegram-deep-link'
  ) {
    return (
      telegramDeepLinkMatches(
        rawUrl,
        rule.value
      )
    );
  }

  const parsed =
    normalizeUrl(
      rawUrl
    );

  if (
    !parsed ||
    typeof parsed ===
      'string'
  ) {
    return false;
  }

  const hostname =
    normalizeHostname(
      parsed.hostname
    );

  // Protocol must match.
  if (
    parsed.protocol
      .toLowerCase() !==
    rule.protocol
  ) {
    return false;
  }

  // Prefix whitelists require the exact host.
  //
  // Subdomains are handled separately by
  // ALLOWED_LINK_DOMAINS when explicitly configured.
  if (
    hostname !==
    rule.hostname
  ) {
    return false;
  }

  // Do not silently allow unusual alternate ports.
  if (
    (
      parsed.port ||
      ''
    ) !==
    rule.port
  ) {
    return false;
  }

  return pathMatchesPrefix(
    parsed.pathname,
    rule.pathname
  );
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

function extractUrls(
  message
) {
  const found =
    new Set();

  const sources = [
    {
      text:
        message?.text ||
        '',

      entities:
        message?.entities ||
        [],
    },
    {
      text:
        message?.caption ||
        '',

      entities:
        message
          ?.caption_entities ||
        [],
    },
  ];

  const patterns = [
    /https?:\/\/[^\s<>()]+/gi,
    /www\.[^\s<>()]+/gi,
    /(?:t\.me|telegram\.me)\/[^\s<>()]+/gi,
    /tg:\/\/[^\s<>()]+/gi,
    /\b(?:[a-z0-9-]+\.)+[a-z]{2,}(?:\/[^\s<>()]*)?/gi,
  ];

  for (
    const source of
    sources
  ) {
    const text =
      source.text;

    for (
      const pattern of
      patterns
    ) {
      const matches =
        text.match(
          pattern
        ) ||
        [];

      for (
        const match of
        matches
      ) {
        found.add(
          match.replace(
            /[),.;!?]+$/g,
            ''
          )
        );
      }
    }

    for (
      const entity of
      source.entities
    ) {
      // Hidden clickable text:
      //
      // "Click here"
      // ->
      // https://example.com
      if (
        entity.type ===
          'text_link' &&
        entity.url
      ) {
        found.add(
          entity.url
        );
      }

      // Telegram URL entity.
      //
      // Telegram entity offsets and JS slicing both use
      // UTF-16 code units.
      if (
        entity.type ===
          'url' &&
        Number.isInteger(
          entity.offset
        ) &&
        Number.isInteger(
          entity.length
        )
      ) {
        const entityUrl =
          text.slice(
            entity.offset,
            entity.offset +
              entity.length
          );

        if (entityUrl) {
          found.add(
            entityUrl
          );
        }
      }
    }
  }

  // ====================================================
  // Inline keyboard buttons
  // ====================================================

  const inlineKeyboard =
    message
      ?.reply_markup
      ?.inline_keyboard ||
    [];

  for (
    const row of
    inlineKeyboard
  ) {
    if (
      !Array.isArray(
        row
      )
    ) {
      continue;
    }

    for (
      const button of
      row
    ) {
      if (!button) {
        continue;
      }

      if (
        button.url
      ) {
        found.add(
          button.url
        );
      }

      if (
        button
          .login_url
          ?.url
      ) {
        found.add(
          button
            .login_url
            .url
        );
      }

      if (
        button
          .web_app
          ?.url
      ) {
        found.add(
          button
            .web_app
            .url
        );
      }
    }
  }

  return [
    ...found,
  ].filter(Boolean);
}

// ======================================================
// Whitelist check
// ======================================================

function isAllowedUrl(
  rawUrl
) {
  // ----------------------------------------------------
  // 1. Exact host/path prefix rules.
  // ----------------------------------------------------

  if (
    allowedLinkPrefixRules
      .some(
        (rule) =>
          matchesAllowedPrefix(
            rawUrl,
            rule
          )
      )
  ) {
    return true;
  }

  // ----------------------------------------------------
  // 2. Whole-domain rules.
  // ----------------------------------------------------

  const parsed =
    normalizeUrl(
      rawUrl
    );

  if (
    !parsed ||
    typeof parsed ===
      'string'
  ) {
    return false;
  }

  const hostname =
    normalizeHostname(
      parsed.hostname
    );

  return (
    allowedLinkDomains
      .some(
        (domain) =>
          hostname ===
            domain ||
          hostname
            .endsWith(
              `.${domain}`
            )
      )
  );
}

function containsUnauthorizedLink(
  message
) {
  const urls =
    extractUrls(
      message
    );

  if (
    urls.length ===
    0
  ) {
    return false;
  }

  // If no whitelist exists, normal members may not
  // post links.
  if (
    allowedLinkPrefixRules
      .length ===
      0 &&
    allowedLinkDomains
      .length ===
      0
  ) {
    return true;
  }

  return urls.some(
    (url) =>
      !isAllowedUrl(
        url
      )
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

function countMentions(
  message
) {
  return getMessageEntities(
    message
  ).filter(
    (entity) =>
      entity.type ===
        'mention' ||
      entity.type ===
        'text_mention'
  ).length;
}

function looksLikeSpam(
  message
) {
  const text =
    normalizeText(
      getMessageText(
        message
      )
    );

  if (!text) {
    return false;
  }

  const keywordHit =
    spamKeywords.some(
      (keyword) =>
        text.includes(
          keyword
        )
    );

  if (keywordHit) {
    return true;
  }

  // Mass tagging is usually promotional/flood behavior.
  if (
    countMentions(
      message
    ) >= 5
  ) {
    return true;
  }

  // Extremely repeated promotional symbols/characters.
  if (
    /(.)\1{14,}/u
      .test(text)
  ) {
    return true;
  }

  return false;
}

// ======================================================
// Flood / duplicate-message detection
// ======================================================

function isFlooding(
  ctx
) {
  const key =
    userKey(ctx);

  const timestamp =
    now();

  const current =
    floodState.get(
      key
    ) || {
      timestamps: [],
      updatedAt:
        timestamp,
    };

  current.timestamps =
    current.timestamps
      .filter(
        (item) =>
          timestamp -
            item <=
          FLOOD_WINDOW_MS
      );

  current.timestamps
    .push(
      timestamp
    );

  current.updatedAt =
    timestamp;

  setBoundedMapEntry(
    floodState,
    key,
    current
  );

  return (
    current
      .timestamps
      .length >
    FLOOD_MAX_MESSAGES
  );
}

function isRepeatedMessage(
  ctx
) {
  const text =
    normalizeText(
      getMessageText(
        ctx.message
      )
    );

  // Ignore tiny messages such as "hi", emojis, etc.
  if (
    text.length <
    8
  ) {
    return false;
  }

  const key =
    userKey(ctx);

  const timestamp =
    now();

  const current =
    repeatState.get(
      key
    ) || {
      text,
      count: 0,
      firstAt:
        timestamp,
      updatedAt:
        timestamp,
    };

  if (
    current.text !==
      text ||
    timestamp -
      current.firstAt >
      REPEAT_WINDOW_MS
  ) {
    setBoundedMapEntry(
      repeatState,
      key,
      {
        text,
        count: 1,
        firstAt:
          timestamp,
        updatedAt:
          timestamp,
      }
    );

    return false;
  }

  current.count +=
    1;

  current.updatedAt =
    timestamp;

  setBoundedMapEntry(
    repeatState,
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

async function isAdmin(
  ctx
) {
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
      adminCache.get(
        key
      );

    if (
      cached &&
      cached.expiresAt >
        now()
    ) {
      return (
        cached.isAdmin
      );
    }

    const member =
      await ctx
        .telegram
        .getChatMember(
          ctx.chat.id,
          ctx.from.id
        );

    const result =
      member.status ===
        'creator' ||
      member.status ===
        'administrator';

    setBoundedMapEntry(
      adminCache,
      key,
      {
        isAdmin:
          result,

        expiresAt:
          now() +
          ADMIN_CACHE_MS,
      }
    );

    return result;
  } catch (error) {
    console.error(
      'Admin check error:',
      error
    );

    // Deliberate fail-safe:
    //
    // If Telegram temporarily cannot verify someone's
    // administrator status, do not accidentally punish
    // a real administrator.
    return true;
  }
}

// ======================================================
// Moderation actions
// ======================================================

async function safeDelete(
  ctx
) {
  try {
    await ctx
      .deleteMessage();

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
  seconds =
    MUTE_SECONDS
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
        Date.now() /
        1000
      ) +
      seconds;

    await ctx.telegram
      .callApi(
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

function recordViolation(
  ctx
) {
  const key =
    userKey(ctx);

  const timestamp =
    now();

  const current =
    violationState.get(
      key
    ) || {
      timestamps: [],
      updatedAt:
        timestamp,
    };

  current.timestamps =
    current.timestamps
      .filter(
        (item) =>
          timestamp -
            item <=
          VIOLATION_WINDOW_MS
      );

  current.timestamps
    .push(
      timestamp
    );

  current.updatedAt =
    timestamp;

  setBoundedMapEntry(
    violationState,
    key,
    current
  );

  return (
    current
      .timestamps
      .length
  );
}

async function moderateViolation(
  ctx,
  reason,
  forceMute =
    false
) {
  if (
    await isAdmin(ctx)
  ) {
    return;
  }

  await safeDelete(ctx);

  const violations =
    recordViolation(
      ctx
    );

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
        chatType !==
          'group' &&
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

      // ==================================================
      // Unauthorized links
      //
      // DELETE MESSAGE ONLY.
      //
      // The member is NOT muted.
      // The member is NOT banned.
      // No violation is recorded for posting a link.
      //
      // Admins are exempt.
      // ==================================================

      if (
        containsUnauthorizedLink(
          message
        )
      ) {
        if (
          !(
            await isAdmin(
              ctx
            )
          )
        ) {
          await safeDelete(
            ctx
          );

          console.log(
            `Moderation: UNAUTHORIZED_LINK_DELETED_ONLY; chat=${ctx.chat?.id}; user=${ctx.from?.id}`
          );
        }

        return;
      }

      // High-confidence spam phrases / mass mentions.
      //
      // This remains separate from link moderation.
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

      // Same non-link message repeated several times.
      if (
        isRepeatedMessage(
          ctx
        )
      ) {
        await moderateViolation(
          ctx,
          'REPEATED_MESSAGE',
          true
        );

        return;
      }

      // Too many non-link messages in a short period.
      if (
        isFlooding(
          ctx
        )
      ) {
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
      // Periodic lightweight time-based cleanup.
      //
      // Hard map limits above remain the guaranteed
      // memory ceiling even if this random cleanup does
      // not run for a while.
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
          ] of adminCache
            .entries()
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
  (
    error,
    ctx
  ) => {
    console.error(
      'Telegram bot error:',
      error,
      'update:',
      ctx?.update
        ?.update_id
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
    Buffer.from(
      received
    );

  const expectedBuffer =
    Buffer.from(
      expected
    );

  if (
    receivedBuffer
      .length !==
    expectedBuffer
      .length
  ) {
    return false;
  }

  return crypto
    .timingSafeEqual(
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

    // IMPORTANT:
    //
    // We intentionally keep the current optional-secret
    // behavior during this first hardening stage.
    //
    // After TELEGRAM_WEBHOOK_SECRET is confirmed in
    // Vercel and the same secret is registered with
    // Telegram setWebhook, the next stage will change
    // this to fail closed.
    //
    // This prevents accidentally disabling the live bot
    // during deployment.
    if (webhookSecret) {
      const receivedSecret =
        req.headers.get(
          'x-telegram-bot-api-secret-token'
        ) ||
        '';

      if (
        !safeEqualSecret(
          receivedSecret,
          webhookSecret
        )
      ) {
        return NextResponse
          .json(
            {
              error:
                'Unauthorized',
            },
            {
              status:
                401,
            }
          );
      }
    }

    const body =
      await req.json();

    await bot
      .handleUpdate(
        body
      );

    return NextResponse
      .json(
        {
          message:
            'Success',
        },
        {
          status:
            200,
        }
      );
  } catch (error) {
    console.error(
      'Webhook Error:',
      error
    );

    return NextResponse
      .json(
        {
          error:
            'Failed to process request',
        },
        {
          status:
            500,
        }
      );
  }
}

// ======================================================
// Health check
// ======================================================

export async function GET() {
  return NextResponse
    .json({
      ok:
        true,

      service:
        'Apex Telegram Bot',

      moderation:
        true,
    });
}
