import { NextResponse } from 'next/server';
import { supabaseAdmin } from '../../../lib/supabase-admin';
import { validateTelegramInitData } from '../../../lib/telegram-auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function reply(body, status = 200) {
  return NextResponse.json(body, { status, headers: { 'Cache-Control': 'no-store' } });
}

function currentAlgiersMonth() {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Africa/Algiers', year: 'numeric', month: '2-digit',
  }).formatToParts(new Date());
  const year = parts.find((part) => part.type === 'year').value;
  const month = parts.find((part) => part.type === 'month').value;
  return `${year}-${month}-01`;
}

export async function POST(request) {
  try {
    const body = await request.json();
    const telegram = validateTelegramInitData(body?.initData);
    const telegramId = String(telegram.user.id);
    const { data: member, error: memberError } = await supabaseAdmin
      .from('users').select('telegram_id').eq('telegram_id', telegramId).maybeSingle();
    if (memberError) return reply({ error: 'Database unavailable' }, 500);
    if (!member) return reply({ error: 'Member not found' }, 403);

    const monthStart = currentAlgiersMonth();
    let { data: snapshot, error: snapshotError } = await supabaseAdmin
      .from('apxn_monthly_top20_snapshots')
      .select('month_start, created_at, top20')
      .eq('month_start', monthStart).maybeSingle();

    if (snapshotError) {
      console.error('Top 20 snapshot read failed', snapshotError.code);
      return reply({ error: 'Leaderboard unavailable' }, 500);
    }

    if (!snapshot) {
      const { data: users, error: usersError } = await supabaseAdmin
        .from('users').select('first_name, username, balance')
        .order('balance', { ascending: false })
        .order('telegram_id', { ascending: true }).limit(20);
      if (usersError) {
        console.error('Top 20 ranking failed', usersError.code);
        return reply({ error: 'Leaderboard unavailable' }, 500);
      }
      const top20 = (users || []).map((user, index) => ({
        rank: index + 1,
        name: String(user.first_name || user.username || 'APXN Miner').slice(0, 50),
        points: Number(user.balance || 0),
      }));
      const { data: inserted, error: insertError } = await supabaseAdmin
        .from('apxn_monthly_top20_snapshots')
        .insert({ month_start: monthStart, top20 })
        .select('month_start, created_at, top20').single();
      if (insertError && insertError.code !== '23505') {
        console.error('Top 20 snapshot save failed', insertError.code);
        return reply({ error: 'Leaderboard unavailable' }, 500);
      }
      if (inserted) {
        snapshot = inserted;
      } else {
        const { data: existing, error: existingError } = await supabaseAdmin
          .from('apxn_monthly_top20_snapshots')
          .select('month_start, created_at, top20')
          .eq('month_start', monthStart).single();
        if (existingError) return reply({ error: 'Leaderboard unavailable' }, 500);
        snapshot = existing;
      }
    }

    return reply({ success: true, month: monthStart.slice(0, 7),
      updatedAt: snapshot.created_at,
      users: Array.isArray(snapshot.top20) ? snapshot.top20 : [] });
  } catch (error) {
    const message = error instanceof Error ? error.message : '';
    const authError = /Telegram|BOT_TOKEN|Expired|signature|init data/i.test(message);
    if (!authError) console.error('Top 20 request failed', message);
    return reply({ error: authError ? 'Invalid Telegram authentication' : 'Request failed' }, authError ? 401 : 500);
  }
}

