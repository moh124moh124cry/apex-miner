import { NextResponse } from 'next/server';
import { validateTelegramInitData } from '../../../lib/telegram-auth';
import { refreshAmbassador } from '../../../lib/apxn-ambassador';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function POST(request) {
  let body, id;
  try {
    body = await request.json();
    id = String(validateTelegramInitData(body?.initData).user.id);
  } catch { return NextResponse.json({ error: 'Invalid Telegram authentication' }, { status: 401 }); }
  try {
    const status = await refreshAmbassador(id, body?.activate === true);
    return NextResponse.json({ success: true, ...status }, { headers: { 'Cache-Control': 'no-store' } });
  } catch { return NextResponse.json({ error: 'Ambassador service temporarily unavailable' }, { status: 503 }); }
}
