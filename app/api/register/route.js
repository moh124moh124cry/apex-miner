import { NextResponse } from 'next/server';
import { supabaseAdmin } from '../../../lib/supabase-admin';
import { validateTelegramInitData } from '../../../lib/telegram-auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const POSTGRES_BIGINT_MAX =
  9223372036854775807n;

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
// Vercel country detection
// =====================================================
//
// Vercel provides the visitor country through:
// x-vercel-ip-country
//
// We only accept a valid 2-letter country code.
//
// Country detection is informational only.
// It never affects authentication, rewards,
// mining or referral eligibility.
// =====================================================

function getCountryCode(request) {
  const rawCountry =
    request.headers.get(
      'x-vercel-ip-country'
    );

  if (!rawCountry) {
    return null;
  }

  const country =
    String(rawCountry)
      .trim()
      .toUpperCase();

  if (
    !/^[A-Z]{2}$/.test(
      country
    )
  ) {
    return null;
  }

  // Vercel/proxies may use XX when the country
  // cannot be determined.
  if (country === 'XX') {
    return null;
  }

  return country;
}

// =====================================================
// Safe Telegram referral parser
// =====================================================
//
// apex_register_user currently accepts PostgreSQL bigint.
//
// start_param is user-controlled input, therefore we
// must never pass an arbitrary numeric string directly
// to PostgreSQL.
//
// This parser:
// - accepts digits only
// - normalizes leading zeroes
// - rejects zero
// - rejects values larger than PostgreSQL bigint
// - rejects self-referrals
// =====================================================

function getSafeReferrerId(
  startParam,
  telegramId
) {
  if (
    startParam === null ||
    startParam === undefined
  ) {
    return null;
  }

  const raw =
    String(startParam)
      .trim();

  if (
    !raw ||
    !/^\d+$/.test(raw)
  ) {
    return null;
  }

  // Avoid processing absurdly large numeric strings.
  if (raw.length > 19) {
    return null;
  }

  try {
    const parsed =
      BigInt(raw);

    if (parsed <= 0n) {
      return null;
    }

    if (
      parsed >
      POSTGRES_BIGINT_MAX
    ) {
      return null;
    }

    const normalized =
      parsed.toString();

    if (
      normalized ===
      String(telegramId)
    ) {
      return null;
    }

    return normalized;
  } catch {
    return null;
  }
}

// =====================================================
// Register
// =====================================================

export async function POST(
  request
) {
  try {
    const body =
      await request.json();

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

    // Central validation in lib/telegram-auth.js
    // already enforces the 8192 limit and Telegram HMAC.
    const telegram =
      validateTelegramInitData(
        initData
      );

    const telegramId =
      String(
        telegram.user.id
      );

    const firstName =
      telegram.user.first_name ||
      '';

    const username =
      telegram.user.username ||
      '';

    const country =
      getCountryCode(
        request
      );

    const referrerId =
      getSafeReferrerId(
        telegram.startParam,
        telegramId
      );

    // =================================================
    // Atomic registration/reward RPC.
    //
    // Existing reward logic remains unchanged.
    // =================================================

    const {
      data,
      error,
    } =
      await supabaseAdmin.rpc(
        'apex_register_user',
        {
          p_telegram_id:
            telegramId,

          p_first_name:
            firstName,

          p_username:
            username,

          p_referrer_id:
            referrerId,
        }
      );

    if (error) {
      console.error(
        'Register user RPC error:',
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

    if (
      !result ||
      !result.success
    ) {
      return response(
        {
          error:
            'Registration failed',
        },
        500
      );
    }

    const created =
      Boolean(
        result.created
      );

    // =================================================
    // Store the Vercel country only for a newly-created
    // account.
    //
    // Do NOT overwrite an existing user's country when
    // they travel or use another network.
    //
    // This is one extra lightweight indexed UPDATE only
    // once in the user's lifetime.
    // =================================================

    let savedCountry = null;

    if (
      created &&
      country
    ) {
      const {
        error: countryError,
      } =
        await supabaseAdmin
          .from('users')
          .update({
            country,
          })
          .eq(
            'telegram_id',
            telegramId
          );

      if (countryError) {
        // Registration itself already succeeded.
        // Never fail/reward twice merely because
        // informational country storage failed.
        console.error(
          'Country save error:',
          countryError.code
        );
      } else {
        savedCountry =
          country;
      }
    }

    return response({
      success: true,

      created,

      user: {
        telegramId,

        firstName,

        username,

        balance:
          Number(
            result.balance ||
            0
          ),

        miningRate:
          Number(
            result.mining_rate ||
            0.00025
          ),

        referredBy:
          result.referred_by !==
            null &&
          result.referred_by !==
            undefined
            ? String(
                result.referred_by
              )
            : null,

        lastClaim:
          result.last_claim ||
          null,

        country:
          savedCountry ||
          'Unknown',
      },

      welcomeBonus:
        Number(
          result.welcome_bonus ||
          0
        ),

      referralBonus:
        Number(
          result.referral_bonus ||
          0
        ),
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
        'Register API error:',
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
