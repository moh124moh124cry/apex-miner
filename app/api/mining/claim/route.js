import { NextResponse } from 'next/server';
import { supabaseAdmin } from '../../../../lib/supabase-admin';
import { validateTelegramInitData } from '../../../../lib/telegram-auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// =====================================================
// Mining constants
// =====================================================

const CLAIM_COOLDOWN_SECONDS = 12 * 60 * 60;

// We do NOT keep the full 12-hour cooldown as a hard
// server-memory block.
//
// Instead, after Supabase confirms the cooldown, this
// instance avoids asking Supabase again for up to
// 10 minutes.
//
// Supabase always remains the final authority.
const MAX_LOCAL_DB_SKIP_SECONDS = 10 * 60;

// Prevent the transient memory map from growing forever.
// If an instance ever handles more than this many recent
// miners, the oldest entries are simply discarded.
//
// Discarding an entry is safe because Supabase still
// performs the real cooldown check.
const MAX_GATE_ENTRIES = 5000;

// =====================================================
// Lightweight per-instance mining gate
// =====================================================
//
// This is only a performance optimization.
//
// Vercel may run multiple server instances, so this map
// is NOT treated as a security boundary.
//
// The Supabase apex_mining_claim RPC remains responsible
// for atomic locking, balance updates and cooldown
// enforcement.
// =====================================================

const miningClaimGate =
  globalThis.__apexMiningClaimGate ||
  new Map();

if (!globalThis.__apexMiningClaimGate) {
  globalThis.__apexMiningClaimGate =
    miningClaimGate;
}

function setGateEntry(
  telegramId,
  entry
) {
  // Refresh insertion order.
  miningClaimGate.delete(
    telegramId
  );

  miningClaimGate.set(
    telegramId,
    entry
  );

  // Keep memory usage bounded.
  while (
    miningClaimGate.size >
    MAX_GATE_ENTRIES
  ) {
    const oldestKey =
      miningClaimGate
        .keys()
        .next()
        .value;

    if (
      oldestKey ===
      undefined
    ) {
      break;
    }

    miningClaimGate.delete(
      oldestKey
    );
  }
}

function removeGateEntry(
  telegramId
) {
  miningClaimGate.delete(
    telegramId
  );
}

function getRemainingCooldown(
  entry,
  now = Date.now()
) {
  if (
    !entry?.cooldownUntil ||
    entry.cooldownUntil <= now
  ) {
    return 0;
  }

  return Math.max(
    1,
    Math.ceil(
      (
        entry.cooldownUntil -
        now
      ) / 1000
    )
  );
}

function buildCooldownGateEntry({
  cooldownSeconds,
  lastClaim,
}) {
  const now = Date.now();

  const safeCooldown =
    Math.max(
      0,
      Number(
        cooldownSeconds || 0
      )
    );

  const dbSkipSeconds =
    Math.min(
      safeCooldown,
      MAX_LOCAL_DB_SKIP_SECONDS
    );

  return {
    inFlight: false,

    cooldownUntil:
      now +
      safeCooldown * 1000,

    nextDbCheckAt:
      now +
      dbSkipSeconds * 1000,

    lastClaim:
      lastClaim || null,
  };
}

// =====================================================
// Response helper
// =====================================================

function response(
  body,
  status = 200
) {
  return NextResponse.json(
    body,
    {
      status,
      headers: {
        'Cache-Control':
          'no-store',
      },
    }
  );
}

// =====================================================
// Mining Claim
// =====================================================

export async function POST(
  request
) {
  let gatedTelegramId = null;

  try {
    const body =
      await request.json();

    const initData =
      body?.initData;

    if (
      !initData ||
      typeof initData !==
        'string'
    ) {
      return response(
        {
          error:
            'Telegram init data is required',
        },
        400
      );
    }

    if (
      initData.length >
      8192
    ) {
      return response(
        {
          error:
            'Invalid Telegram init data',
        },
        400
      );
    }

    // =================================================
    // Authenticate the real Telegram Mini App user.
    // =================================================

    const telegram =
      validateTelegramInitData(
        initData
      );

    const telegramId =
      String(
        telegram.user.id
      );

    gatedTelegramId =
      telegramId;

    const now =
      Date.now();

    const existingGate =
      miningClaimGate.get(
        telegramId
      );

    // =================================================
    // 1. A request for this user is already reaching
    //    Supabase on this Vercel instance.
    //
    //    Stop duplicate concurrent requests here.
    // =================================================

    if (
      existingGate?.inFlight
    ) {
      const knownRemaining =
        getRemainingCooldown(
          existingGate,
          now
        );

      return response(
        {
          error:
            'Claim request already in progress',

          retryAfter:
            knownRemaining > 0
              ? knownRemaining
              : 1,

          cooldown:
            CLAIM_COOLDOWN_SECONDS,

          lastClaim:
            existingGate
              .lastClaim ||
            null,
        },
        429
      );
    }

    // =================================================
    // 2. Supabase already confirmed recently that this
    //    user is in cooldown.
    //
    //    Avoid another database request until the local
    //    re-check window expires.
    //
    //    We still return the REAL remaining cooldown to
    //    the frontend, not just the 10-minute local gate.
    // =================================================

    if (
      existingGate &&
      existingGate.cooldownUntil >
        now &&
      existingGate.nextDbCheckAt >
        now
    ) {
      return response(
        {
          error:
            'Claim cooldown active',

          retryAfter:
            getRemainingCooldown(
              existingGate,
              now
            ),

          cooldown:
            CLAIM_COOLDOWN_SECONDS,

          lastClaim:
            existingGate
              .lastClaim ||
            null,
        },
        429
      );
    }

    // =================================================
    // Mark this user as in-flight BEFORE calling
    // Supabase.
    //
    // If we already knew a cooldown value from an older
    // check, preserve it while refreshing against the
    // database.
    // =================================================

    setGateEntry(
      telegramId,
      {
        inFlight: true,

        cooldownUntil:
          existingGate
            ?.cooldownUntil ||
          0,

        nextDbCheckAt: 0,

        lastClaim:
          existingGate
            ?.lastClaim ||
          null,
      }
    );

    // =================================================
    // One authoritative Supabase RPC.
    // =================================================

    const {
      data,
      error,
    } =
      await supabaseAdmin.rpc(
        'apex_mining_claim',
        {
          p_telegram_id:
            telegramId,
        }
      );

    if (error) {
      // Do not lock a real user out when Supabase itself
      // returned an unexpected database error.
      removeGateEntry(
        telegramId
      );

      console.error(
        'Mining claim RPC error:',
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

    const result =
      Array.isArray(data)
        ? data[0]
        : data;

    if (!result) {
      removeGateEntry(
        telegramId
      );

      return response(
        {
          error:
            'Invalid mining claim result',
        },
        500
      );
    }

    // =================================================
    // Supabase says the user is still in cooldown.
    //
    // Cache that result locally for a short period so
    // repeated requests do not keep touching Supabase.
    // =================================================

    if (
      !result.success
    ) {
      if (
        result.error_code ===
        'COOLDOWN'
      ) {
        const retryAfter =
          Math.max(
            1,
            Number(
              result.retry_after ||
              0
            )
          );

        const lastClaim =
          result.last_claim ||
          null;

        setGateEntry(
          telegramId,
          buildCooldownGateEntry({
            cooldownSeconds:
              retryAfter,
            lastClaim,
          })
        );

        return response(
          {
            error:
              'Claim cooldown active',

            balance:
              Number(
                result.balance ||
                0
              ),

            retryAfter,

            cooldown:
              Number(
                result.cooldown ||
                CLAIM_COOLDOWN_SECONDS
              ),

            lastClaim,
          },
          429
        );
      }

      if (
        result.error_code ===
        'USER_NOT_FOUND'
      ) {
        removeGateEntry(
          telegramId
        );

        return response(
          {
            error:
              'User not found',
          },
          404
        );
      }

      removeGateEntry(
        telegramId
      );

      return response(
        {
          error:
            'Claim failed',
        },
        400
      );
    }

    // =================================================
    // Successful claim.
    //
    // Keep a short local protection window while
    // preserving the actual 12-hour remaining cooldown
    // that the frontend should display.
    // =================================================

    const cooldown =
      Math.max(
        1,
        Number(
          result.cooldown ||
          CLAIM_COOLDOWN_SECONDS
        )
      );

    const lastClaim =
      result.last_claim ||
      null;

    setGateEntry(
      telegramId,
      buildCooldownGateEntry({
        cooldownSeconds:
          cooldown,
        lastClaim,
      })
    );

    return response({
      success: true,

      balance:
        Number(
          result.balance ||
          0
        ),

      claimed:
        Number(
          result.claimed ||
          0
        ),

      miningRate:
        Number(
          result.mining_rate ||
          0.00025
        ),

      baseMiningRate:
        Number(
          result.base_mining_rate ||
          0.00025
        ),

      activeFriends:
        Number(
          result.active_friends ||
          0
        ),

      lastClaim,

      cooldown,
    });

  } catch (error) {
    // If an unexpected exception happened after the local
    // gate was acquired, release it so a legitimate user
    // can retry.
    if (gatedTelegramId) {
      const entry =
        miningClaimGate.get(
          gatedTelegramId
        );

      if (
        entry?.inFlight
      ) {
        removeGateEntry(
          gatedTelegramId
        );
      }
    }

    const message =
      error instanceof Error
        ? error.message
        : 'Unknown error';

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
        'Mining claim API error:',
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
