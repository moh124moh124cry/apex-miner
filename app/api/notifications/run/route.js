import crypto from 'crypto';
import { NextResponse } from 'next/server';
import { processTelegramNotifications } from '../../../../lib/telegram-notifications';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

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

function safeEqual(
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

export async function POST(
  request
) {
  const expectedSecret =
    process.env
      .NOTIFICATION_RUN_SECRET ||
    '';

  if (!expectedSecret) {
    console.error(
      'NOTIFICATION_RUN_SECRET missing'
    );

    return response(
      {
        error:
          'Service unavailable',
      },
      503
    );
  }

  const authorization =
    request.headers.get(
      'authorization'
    ) || '';

  const receivedSecret =
    authorization.startsWith(
      'Bearer '
    )
      ? authorization
          .slice(7)
          .trim()
      : '';

  if (
    !safeEqual(
      receivedSecret,
      expectedSecret
    )
  ) {
    return response(
      {
        error:
          'Unauthorized',
      },
      401
    );
  }

  try {
    const result =
      await processTelegramNotifications();

    return response(
      result,
      200
    );
  } catch (error) {
    console.error(
      'Telegram notification run failed:',
      error instanceof Error
        ? error.message
        : 'Unknown error'
    );

    return response(
      {
        error:
          'Notification run failed',
      },
      500
    );
  }
}

export async function GET() {
  return response(
    {
      ok: true,
      service:
        'APXN Telegram notifications',
      protected:
        true,
    },
    200
  );
}

