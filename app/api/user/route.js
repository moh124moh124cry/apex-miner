import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

export async function POST(request) {
  try {
    const body = await request.json();
    const { telegramId } = body;

    if (!telegramId) {
      return NextResponse.json({ error: 'Telegram ID is required' }, { status: 400 });
    }

    // التقاط دولة المستخدم من سيرفرات Vercel
    const country = request.headers.get('x-vercel-ip-country') || 'Unknown';

    // تحديث عمود الدولة في قاعدة البيانات
    const { error } = await supabase
      .from('users')
      .update({ country: country })
      .eq('telegram_id', telegramId);

    if (error) throw error;

    return NextResponse.json({ success: true, country });
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
