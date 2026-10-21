import { NextResponse } from 'next/server';
import { supabaseAdmin } from '../../../../../lib/supabase-admin';
import { validateTelegramInitData } from '../../../../../lib/telegram-auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function response(body, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: { 'Cache-Control': 'no-store' },
  });
}

// Read-only, Telegram-authenticated history of paid boost intervals.
// This keeps 10k legacy purchases and 5k new purchases accurately reflected
// in the client's estimated balance. Authoritative rewards remain in SQL.
export async function POST(request) {
  try {
    const body = await request.json();
    const initData = body?.initData;
    if (typeof initData !== 'string' || !initData || initData.length > 8192) {
      return response({ error: 'Invalid Telegram authentication' }, 401);
    }
    const telegram = validateTelegramInitData(initData);
    const telegramId = String(telegram.user.id);
    const { data: user, error: userError } = await supabaseAdmin
      .from('users')
      .select('last_claim')
      .eq('telegram_id', telegramId)
      .maybeSingle();
    if (userError) throw userError;
    if (!user) return response({ error: 'User not found' }, 404);

    const { data: events, error: eventsError } = await supabaseAdmin
      .from('stars_boost_events')
      .select('started_at,ends_at,reward_total')
      .eq('telegram_id', telegramId)
      .gt('ends_at', user.last_claim || '1970-01-01T00:00:00.000Z')
      .order('started_at', { ascending: true })
      .limit(100);
    if (eventsError) throw eventsError;

    const serverNow = Date.now();
    const mappedEvents = (events || []).map((event) => ({
      startedAt: event.started_at,
      endsAt: event.ends_at,
      rewardTotal: Number(event.reward_total || 0),
    }));
    const current = mappedEvents.find((event) =>
      Date.parse(event.startedAt) <= serverNow &&
      Date.parse(event.endsAt) > serverNow
    );
    return response({
      success: true,
      currentRewardPoints: current ? current.rewardTotal : 5000,
      events: mappedEvents,
      serverNow: new Date(serverNow).toISOString(),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    if (/Telegram|BOT_TOKEN|Expired|signature|auth_date/i.test(message)) {
      return response({ error: 'Invalid or expired Telegram authentication' }, 401);
    }
    console.error('Stars boost status API error:', error?.code || message);
    return response({ error: 'Stars boost status is temporarily unavailable' }, 503);
  }
}

