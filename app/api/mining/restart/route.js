import { NextResponse } from 'next/server';
import { supabaseAdmin } from '../../../../lib/supabase-admin';
import { validateTelegramInitData } from '../../../../lib/telegram-auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const CLAIM_COOLDOWN_SECONDS = 12 * 60 * 60;

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

    // The frontend calls this route only after the
    // Monetag restart ad promise completes successfully.
    //
    // Supabase remains the final authority:
    // - the old 24-hour session must already be expired
    // - any remaining payable mining amount is finalized
    // - a new fixed 24-hour session is created
    // - last_claim is moved to the restart time
    // - event / referral / x3 accounting remains intact
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

      cooldown:
        Number(
          result.cooldown ||
          CLAIM_COOLDOWN_SECONDS
        ),

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

