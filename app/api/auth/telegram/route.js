import { NextResponse } from 'next/server';
import { validateTelegramInitData } from '../../../../lib/telegram-auth';

export const runtime = 'nodejs';

export async function POST(request) {
  try {
    const body = await request.json();
    const { initData } = body;

    if (!initData || typeof initData !== 'string') {
      return NextResponse.json(
        { error: 'Telegram init data is required' },
        { status: 400 }
      );
    }

    const telegram = validateTelegramInitData(initData);

    return NextResponse.json({
      success: true,
      user: {
        id: telegram.user.id,
        firstName: telegram.user.first_name || '',
        lastName: telegram.user.last_name || '',
        username: telegram.user.username || '',
        languageCode: telegram.user.language_code || '',
      },
      startParam: telegram.startParam,
    });
  } catch (error) {
    console.error('Telegram authentication error:', error.message);

    return NextResponse.json(
      { error: 'Invalid Telegram authentication' },
      { status: 401 }
    );
  }
}
