import { NextResponse } from 'next/server';
import { supabaseAdmin } from '../../../lib/supabase-admin';

export async function POST(request) {
  try {
    const body = await request.json();
    const { telegramId } = body;

    if (!telegramId) {
      return NextResponse.json(
        { error: 'Telegram ID is required' },
        { status: 400 }
      );
    }

    const country =
      request.headers.get('x-vercel-ip-country') || 'Unknown';

    const { error } = await supabaseAdmin
      .from('users')
      .update({ country })
      .eq('telegram_id', telegramId);

    if (error) {
      throw error;
    }

    return NextResponse.json({
      success: true,
      country,
    });
  } catch (error) {
    console.error('API user error:', error);

    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
