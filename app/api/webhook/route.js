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

  if (
    prefix ===
    '/'
  ) {
    return true;
  }

  if (
    candidate ===
    prefix
  ) {
    return true;
  }

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

  if (
    parsed.protocol
      .toLowerCase() !==
    rule.protocol
  ) {
    return false;
  }

  if (
    hostname !==
    rule.hostname
  ) {
    return false;
  }

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
      if (
        entity.type ===
          'text_link' &&
        entity.url
      ) {
        found.add(
          entity.url
        );
      }

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
 
