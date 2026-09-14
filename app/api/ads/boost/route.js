import { NextResponse } from 'next/server';
import { supabaseAdmin } from '../../../../lib/supabase-admin';
import { validateTelegramInitData } from '../../../../lib/telegram-auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const BOOST_DURATION_SECONDS = 24 * 60 * 60;

// =====================================================
// Lightweight per-instance boost gate
// =====================================================
//
// This only reduces duplicate concurrent requests on the
// same Vercel instance.
//
// Supabase remains the final authority for:
// - one active boost at a time
// - no stacking
// - exact 24-hour duration
// - atomic activation
// =====================================================

const boostInFlight =
  globalThis.__apexBoostInFlight ||
  new Set();

if (!globalThis.__apexBoostInFlight) {
  globalThis.__apexBoostInFlight =
    boostInFlight;
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
// Rewarded Ad Mining Boost Activation
// =====================================================

export async function POST(
  request
) {
  let telegramId = null;

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

    telegramId =
      String(
        telegram.user.id
      );

    // =================================================
    // Stop duplicate concurrent activation requests on
    // this Vercel instance.
    // =================================================

    if (
      boostInFlight.has(
        telegramId
      )
    ) {
      return response(
        {
          error:
            'Boost activation already in progress',

          retryAfter: 1,
        },
        429
      );
    }

    boostInFlight.add(
      telegramId
    );

    // =================================================
    // Authoritative Supabase RPC.
    // =================================================

    const {
      data,
      error,
    } =
      await supabaseAdmin.rpc(
        'apex_activate_mining_boost',
        {
          p_telegram_id:
            telegramId,
        }
      );

    if (error) {
      console.error(
        'Mining boost RPC error:',
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
      return response(
        {
          error:
            'Invalid mining boost result',
        },
        500
      );
    }

    // =================================================
    // Boost was not activated.
    // =================================================

    if (
      !result.success
    ) {
      if (
        result.error_code ===
        'BOOST_ACTIVE'
      ) {
        return response(
          {
            error:
              'Mining boost already active',

            active: true,

            boostStartedAt:
              result
                .mining_boost_started_at ||
              null,

            boostUntil:
              result
                .mining_boost_until ||
              null,

            boostCount:
              Number(
                result
                  .mining_boost_count ||
                0
              ),

            retryAfter:
              Math.max(
                1,
                Number(
                  result
                    .retry_after ||
                  0
                )
              ),

            duration:
              BOOST_DURATION_SECONDS,

            multiplier: 3,
          },
          409
        );
      }

      if (
        result.error_code ===
        'USER_NOT_FOUND'
      ) {
        return response(
          {
            error:
              'User not found',
          },
          404
        );
      }

      return response(
        {
          error:
            'Mining boost activation failed',
        },
        400
      );
    }

    // =================================================
    // Successful activation.
    // =================================================

    return response({
      success: true,

      active: true,

      multiplier: 3,

      duration:
        BOOST_DURATION_SECONDS,

      boostStartedAt:
        result
          .mining_boost_started_at ||
        null,

      boostUntil:
        result
          .mining_boost_until ||
        null,

      boostCount:
        Number(
          result
            .mining_boost_count ||
          0
        ),

      retryAfter:
        BOOST_DURATION_SECONDS,
    });

  } catch (error) {
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
        'Mining boost API error:',
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

  } finally {
    if (telegramId) {
      boostInFlight.delete(
        telegramId
      );
    }
  }
}

