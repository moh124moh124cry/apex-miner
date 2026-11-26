import { supabaseAdmin } from './supabase-admin';

async function sync(id, matches = null, observed = null, activate = false) {
  const { data, error } = await supabaseAdmin.rpc('apxn_ambassador_sync', {
    p_id: id, p_matches: matches, p_observed_at: observed, p_activate: activate,
  });
  if (error || !data) throw new Error('Ambassador status unavailable');
  return data;
}

export async function refreshAmbassador(id, activate = false) {
  const current = await sync(id);
  const due = current.active && Date.parse(current.verifiedUntil || '') <= Date.now();
  if (!activate && !due) return current;
  if (!process.env.BOT_TOKEN) return { ...current, verificationError: true };
  let chat;
  const observed = new Date().toISOString();
  try {
    const result = await fetch(`https://api.telegram.org/bot${process.env.BOT_TOKEN}/getChat`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: id }), cache: 'no-store', signal: AbortSignal.timeout(7000),
    });
    const json = await result.json();
    if (!result.ok || !json.ok || json.result?.type !== 'private' || String(json.result.id) !== id ||
        typeof json.result.first_name !== 'string') throw new Error('Telegram unavailable');
    chat = json.result;
  } catch {
    // Never revoke on network errors, bot blocks or Telegram rate limits.
    return { ...current, verificationError: true };
  }
  const name = `${chat.first_name} ${chat.last_name || ''}`.trim();
  const matches = /(?:^|[^\p{L}\p{N}_])APXN(?:$|[^\p{L}\p{N}_])/iu.test(name);
  const status = await sync(id, matches, observed, activate);
  return { ...status, nameMatches: matches };
}
