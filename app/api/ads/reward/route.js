import { NextResponse } from 'next/server';
import { supabaseAdmin } from '../../../../lib/supabase-admin';
import { validateTelegramInitData } from '../../../../lib/telegram-auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const AD_REWARD_COOLDOWN_SECONDS = 24 * 60 * 60;

// =====================================================
// Lightweight per-instance rewarded-ad gate
// =====================================================
//
// This gate only stops concurrent duplicate requests on
// the same Vercel instance.
//
// It is NOT the security boundary because Vercel may run
// multiple instances.
//
// Supabase apex_claim_ad_reward remains the final
// authority for:
// - 150 APXN reward
// - Balance update
// - Full rolling 24-hour cooldown
// - Atomic row locking
// =====================================================

const adRewardInFlight =
  globalThis.__apexAdRewardInFlight ||
  new Set();

if (!globalThis.__apexAdRewardInFlight) {
  globalThis.__apexAdRewardInFlight =
    adRewardInFlight;
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
// Rewarded Ad Claim
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
    // Prevent two simultaneous requests for the same
    // user on this Vercel instance.
    // =================================================

    if (
      adRewardInFlight.has(
        telegramId
      )
    ) {
      return response(
        {
          error:
            'Ad reward request already in progress',

          retryAfter: 1,
        },
        429
      );
    }

    adRewardInFlight.add(
      telegramId
    );

    // =================================================
    // One authoritative Supabase RPC.
    // =================================================

    const {
      data,
      error,
    } =
      await supabaseAdmin.rpc(
        'apex_claim_ad_reward',
        {
          p_telegram_id:
            telegramId,
        }
      );

    if (error) {
      console.error(
        'Ad reward RPC error:',
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
            'Invalid ad reward result',
        },
        500
      );
    }

    // =================================================
    // Reward not granted.
    // =================================================

    if (
      !result.success
    ) {
      if (
        result.error_code ===
        'COOLDOWN'
      ) {
        return response(
          {
            error:
              'Ad reward cooldown active',

            balance:
              Number(
                result.balance ||
                0
              ),

            lastAdRewardAt:
              result
                .last_ad_reward_at ||
              null,

            adRewardCount:
              Number(
                result
                  .ad_reward_count ||
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

            cooldown:
              AD_REWARD_COOLDOWN_SECONDS,
          },
          429
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
            'Ad reward failed',
        },
        400
      );
    }

    // =================================================
    // Successful reward.
    // =================================================

    return response({
      success: true,

      reward:
        Number(
          result.reward ||
          150
        ),

      balance:
        Number(
          result.balance ||
          0
        ),

      lastAdRewardAt:
        result
          .last_ad_reward_at ||
        null,

      adRewardCount:
        Number(
          result
            .ad_reward_count ||
          0
        ),

      cooldown:
        AD_REWARD_COOLDOWN_SECONDS,
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
        'Ad reward API error:',
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
      adRewardInFlight.delete(
        telegramId
      );
    }
  }
}

