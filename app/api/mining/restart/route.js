import { NextResponse } from 'next/server';
import { supabaseAdmin } from '../../../../lib/supabase-admin';
import { validateTelegramInitData } from '../../../../lib/telegram-auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MINING_SESSION_DURATION_SECONDS = 24 * 60 * 60;

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

    // Authenticate the real Telegram Mini App user.
    const telegram =
      validateTelegramInitData(
        initData
      );

    const telegramId =
      String(
        telegram.user.id
      );

    // Preserve compatibility with existing Mini App releases.
    //
    // Supported modes:
    // - ad_completed: the restart ad was shown and completed.
    // - ad_unavailable: no ad was available within the 5-second window.
    // - ph_ad_unavailable: legacy mode kept for older Philippine clients.
    const restartMode =
      body?.restartMode ||
      'ad_completed';

    if (
      restartMode !== 'ad_completed' &&
      restartMode !== 'ad_unavailable' &&
      restartMode !== 'ph_ad_unavailable'
    ) {
      return response(
        {
          error: 'Invalid mining restart mode',
        },
        400
      );
    }

    // Legacy compatibility only:
    // Old app versions may still send ph_ad_unavailable.
    // Keep the old Philippine country verification for those cached clients.
    // The new ad_unavailable mode is global and does not enter this block.
    if (restartMode === 'ph_ad_unavailable') {
      const {
        data: countryUser,
        error: countryError,
      } =
        await supabaseAdmin
          .from('users')
          .select('country')
          .eq('telegram_id', telegramId)
          .maybeSingle();

      if (countryError) {
        console.error(
          'Philippines mining restart country lookup error:',
          countryError.code
        );

        return response(
          { error: 'Database error' },
          500
        );
      }

      if (!countryUser) {
        return response(
          { error: 'User not found' },
          404
        );
      }

      if (
        String(countryUser.country || '')
          .trim()
          .toUpperCase() !== 'PH'
      ) {
        return response(
          {
            error: 'Legacy Philippine ad-free mining restart is limited to Philippine accounts',
          },
          403
        );
      }
    }

    // The frontend calls this API after either:
    // - the restart ad completes, or
    // - no ad is available within the 5-second availability window.
    //
    // Supabase remains the final authority:
    // - the old 24-hour session must already be expired
    // - any remaining payable mining amount is finalized
    // - a new fixed 24-hour session is created
    // - last_claim is moved to the restart time
    // - event / referral / x3 accounting remains intact
    //
    // The fallback mode only skips the ad requirement when no ad
    // was available. It does not bypass the 24-hour session rules.
    const {
      data,
      error,
    } =
      await supabaseAdmin.rpc(
        'apex_restart_mining_session',
        {
          p_telegram_id:
            telegramId,
        }
      );

    if (error) {
      console.error(
        'Mining restart RPC error:',
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
            'Invalid mining restart result',
        },
        500
      );
    }

    if (!result.success) {
      if (
        result.error_code ===
        'SESSION_ACTIVE'
      ) {
        return response(
          {
            error:
              'Mining session is still active',

            errorCode:
              'SESSION_ACTIVE',

            retryAfter:
              Math.max(
                1,
                Number(
                  result.retry_after ||
                  1
                )
              ),
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
            'Mining restart failed',
        },
        400
      );
    }

    // Read only the authoritative new session end.
    //
    // This happens once per 24-hour restart, so it has
    // negligible database impact and avoids relying on
    // the phone clock for the new session end.
    const {
      data: sessionUser,
      error: sessionError,
    } =
      await supabaseAdmin
        .from('users')
        .select(
          'mining_session_ends_at'
        )
        .eq(
          'telegram_id',
          telegramId
        )
        .maybeSingle();

    if (
      sessionError ||
      !sessionUser
    ) {
      console.error(
        'Mining restart session read error:',
        sessionError?.code ||
          'USER_NOT_FOUND'
      );

      return response(
        {
          error:
            'Database error',
        },
        500
      );
    }

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

      lastClaim:
        result.last_claim ||
        null,

      // Points are claimed at the 24-hour restart only.
      // Do not expose the retired 12-hour claim cooldown.
      cooldown: MINING_SESSION_DURATION_SECONDS,

      miningSessionEndsAt:
        sessionUser
          .mining_session_ends_at ||
        null,
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
        'Mining restart API error:',
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

