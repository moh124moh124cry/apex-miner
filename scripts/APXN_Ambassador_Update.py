#!/usr/bin/env python3
"""APXN Ambassador installer. Run from the cloudflare-migration repository root.
Default: dry run. --write creates a reviewable local patch, no deployment.
--sql prints the database migration (for a TEST Supabase project first).
Requires Python 3.8+. No credentials required. Never runs SQL automatically.
"""
import argparse
from pathlib import Path
import subprocess
import sys

SQL = r'''BEGIN;
-- Conditional points are tracked separately from normal rewards.
CREATE TABLE public.apxn_ambassadors (
  telegram_id text PRIMARY KEY REFERENCES public.users(telegram_id),
  active boolean NOT NULL DEFAULT false,
  reward_ever_granted boolean NOT NULL DEFAULT false,
  credited numeric NOT NULL DEFAULT 0 CHECK (credited >= 0),
  checked_at timestamptz,
  verified_until timestamptz
);
CREATE TABLE public.apxn_ambassador_periods (
  telegram_id text NOT NULL REFERENCES public.apxn_ambassadors(telegram_id) ON DELETE CASCADE,
  starts_at timestamptz NOT NULL,
  ends_at timestamptz NOT NULL CHECK (ends_at > starts_at),
  PRIMARY KEY (telegram_id, starts_at)
);
ALTER TABLE public.apxn_ambassadors ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.apxn_ambassador_periods ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.apxn_ambassadors, public.apxn_ambassador_periods FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.apxn_ambassadors, public.apxn_ambassador_periods TO service_role;

-- Authenticated server calls only. Null means read status; false means
-- Telegram returned a successful private-chat response without the APXN tag.
CREATE FUNCTION public.apxn_ambassador_sync(p_id text, p_matches boolean DEFAULT NULL,
  p_observed_at timestamptz DEFAULT NULL, p_activate boolean DEFAULT false)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE
  a public.apxn_ambassadors%ROWTYPE;
  u public.users%ROWTYPE;
  t timestamptz := clock_timestamp();
  changed boolean := false;
  cutoff timestamptz;
  periods jsonb;
BEGIN
  SELECT * INTO u FROM public.users WHERE telegram_id = p_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'USER_NOT_FOUND'; END IF;
  SELECT * INTO a FROM public.apxn_ambassadors WHERE telegram_id = p_id;
  IF p_matches IS NOT NULL THEN
    IF p_observed_at IS NULL OR p_observed_at < t - interval '2 minutes'
       OR p_observed_at > t + interval '5 seconds' THEN
      RAISE EXCEPTION 'STALE_OBSERVATION';
    END IF;
    IF a.checked_at IS NULL OR p_observed_at > a.checked_at THEN
      IF p_matches AND (coalesce(a.active,false) OR p_activate) THEN
        IF a.telegram_id IS NULL THEN
          INSERT INTO public.apxn_ambassadors(telegram_id) VALUES (p_id) RETURNING * INTO a;
        END IF;
        IF NOT a.reward_ever_granted THEN
          UPDATE public.users SET balance = coalesce(balance,0)+5000 WHERE telegram_id=p_id RETURNING * INTO u;
          a.credited := a.credited + 5000;
          a.reward_ever_granted := true;
          changed := true;
        END IF;
        cutoff := p_observed_at + interval '24 hours';
        IF a.active AND a.verified_until >= p_observed_at THEN
          UPDATE public.apxn_ambassador_periods SET ends_at=cutoff
            WHERE telegram_id=p_id AND ends_at=a.verified_until;
          IF NOT FOUND THEN RAISE EXCEPTION 'PERIOD_MISSING'; END IF;
        ELSE
          INSERT INTO public.apxn_ambassador_periods VALUES(p_id,p_observed_at,cutoff);
        END IF;
        a.active := true;
        a.verified_until := cutoff;
      ELSIF NOT p_matches AND coalesce(a.active,false) THEN
        -- Revoke exactly the credited Ambassador amount; other rewards stay intact.
        -- Abort rather than take unrelated points if an external debit spent the conditional amount.
        IF coalesce(u.balance,0) < a.credited THEN RAISE EXCEPTION 'AMBASSADOR_BALANCE_REVIEW'; END IF;
        UPDATE public.users SET balance=balance-a.credited WHERE telegram_id=p_id RETURNING * INTO u;
        DELETE FROM public.apxn_ambassador_periods WHERE telegram_id=p_id;
        a.active := false; a.credited := 0; a.verified_until := NULL;
        changed := true;
      END IF;
      -- Store negative observations too, so a delayed positive reply cannot override them.
      IF a.telegram_id IS NULL THEN
        INSERT INTO public.apxn_ambassadors(telegram_id,checked_at) VALUES(p_id,p_observed_at) RETURNING * INTO a;
      ELSE
        UPDATE public.apxn_ambassadors SET active=a.active, reward_ever_granted=a.reward_ever_granted,
          credited=a.credited, checked_at=p_observed_at, verified_until=a.verified_until
          WHERE telegram_id=p_id RETURNING * INTO a;
      END IF;
    END IF;
  END IF;
  SELECT coalesce(jsonb_agg(jsonb_build_object('start',starts_at,'end',ends_at) ORDER BY starts_at),'[]'::jsonb)
    INTO periods FROM public.apxn_ambassador_periods
    WHERE telegram_id=p_id AND ends_at > coalesce(u.last_claim,t);
  RETURN jsonb_build_object('active',coalesce(a.active,false),'rewardEverGranted',coalesce(a.reward_ever_granted,false),
    'credited',coalesce(a.credited,0),'verifiedUntil',a.verified_until,'checkedAt',a.checked_at,
    'balance',coalesce(u.balance,0),'changed',changed,'lastClaim',u.last_claim,
    'sessionEnd',u.mining_session_ends_at,'periods',periods,'serverNow',t);
END $$;
REVOKE EXECUTE ON FUNCTION public.apxn_ambassador_sync(text,boolean,timestamptz,boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.apxn_ambassador_sync(text,boolean,timestamptz,boolean) TO service_role;

-- Called only inside existing mining RPCs, while the user's row is locked.
-- The extra 0.003 is not multiplied by referrals or x3; it stops at session end.
CREATE FUNCTION public.apxn_ambassador_settle(p_id text,p_start timestamptz,p_end timestamptz)
RETURNS numeric LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE amount numeric := 0;
BEGIN
  IF p_start IS NULL OR p_end IS NULL OR p_end <= p_start THEN RETURN 0; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.apxn_ambassadors WHERE telegram_id=p_id AND active) THEN RETURN 0; END IF;
  SELECT coalesce(sum(greatest(0::numeric, extract(epoch from (least(p_end,ends_at)-greatest(p_start,starts_at))))),0)*0.003
    INTO amount FROM public.apxn_ambassador_periods WHERE telegram_id=p_id AND starts_at<p_end AND ends_at>p_start;
  UPDATE public.apxn_ambassadors SET credited=credited+amount WHERE telegram_id=p_id;
  -- Keep the last interval for re-verification; remove old, already paid periods.
  DELETE FROM public.apxn_ambassador_periods p WHERE p.telegram_id=p_id AND p.ends_at<=p_end
    AND p.ends_at < (SELECT a.verified_until FROM public.apxn_ambassadors a WHERE a.telegram_id=p_id);
  RETURN amount;
END $$;
REVOKE EXECUTE ON FUNCTION public.apxn_ambassador_settle(text,timestamptz,timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.apxn_ambassador_settle(text,timestamptz,timestamptz) TO service_role;

-- Preserve the exact existing RPC implementations, changing only their reward sum.
-- If either current definition differs from the reviewed anchor, abort all DDL.
DO $patch$
DECLARE f regprocedure; src text; anchor text := 'v_claimed := v_claimed + v_stars_bonus;';
BEGIN
  FOREACH f IN ARRAY ARRAY['public.apex_mining_claim(bigint)'::regprocedure,'public.apex_restart_mining_session(bigint)'::regprocedure] LOOP
    src := pg_get_functiondef(f);
    IF (length(src)-length(replace(src,anchor,'')))/length(anchor) <> 1
      OR position('v_accrual_end' in src)=0 OR position('for update' in lower(src))=0 THEN
      RAISE EXCEPTION 'Unexpected mining function: %',f;
    END IF;
    EXECUTE replace(src,anchor,'v_claimed := v_claimed + v_stars_bonus + public.apxn_ambassador_settle(p_telegram_id::text, v_last_claim, v_accrual_end);');
  END LOOP;
END $patch$;
COMMIT;
'''

SERVER = r'''import { supabaseAdmin } from './supabase-admin';

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
'''

ROUTE = r'''import { NextResponse } from 'next/server';
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
'''

# Hook at module scope; existing balance and normal mining state remain authoritative.
HOOK = r'''
function useAPXNAmbassador(userId, isDataLoaded, onBalance) {
  const [status, setStatus] = useState(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [clock, setClock] = useState(Date.now());
  const inFlight = useRef(false);
  const callback = useRef(onBalance);
  callback.current = onBalance;
  const load = async (activate = false) => {
    if (!userId || !isDataLoaded || inFlight.current) return;
    const initData = window.Telegram?.WebApp?.initData;
    if (!initData) return;
    inFlight.current = true;
    if (activate) { setBusy(true); setMessage(''); }
    try {
      const res = await fetch('/api/ambassador', { method: 'POST', headers: {'Content-Type':'application/json'},
        body: JSON.stringify({initData, activate}), cache: 'no-store' });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error('Verification unavailable. Try again later.');
      setStatus(data);
      if (data.changed || activate) callback.current(Number(data.balance));
      if (data.verificationError) setMessage('Telegram is temporarily unavailable. No rewards were removed. Try again.');
      else if (activate) setMessage(data.nameMatches ? 'APXN Ambassador boost activated!' : 'Add APXN to your Telegram profile name, then verify again.');
    } catch (err) { if (activate) setMessage(err.message); }
    finally { inFlight.current = false; setBusy(false); }
  };
  useEffect(() => {
    if (!userId || !isDataLoaded) return;
    void load();
    const focus = () => { if (document.visibilityState === 'visible') void load(); };
    document.addEventListener('visibilitychange', focus);
    return () => document.removeEventListener('visibilitychange', focus);
  }, [userId, isDataLoaded]);
  useEffect(() => {
    const timer = setInterval(() => setClock(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  useEffect(() => {
    if (!status?.active || Date.parse(status.verifiedUntil) > Date.now()) return;
    void load();
    const timer = setInterval(() => void load(), 300000);
    return () => clearInterval(timer);
  }, [userId, isDataLoaded, status?.active, status?.verifiedUntil, Math.floor(clock / 60000)]);
  const active = Boolean(status?.active && Date.parse(status.verifiedUntil) > clock);
  const lastClaim = Date.parse(status?.lastClaim || '');
  const sessionEnd = Date.parse(status?.sessionEnd || '');
  const pending = status?.active && Number.isFinite(lastClaim) && Number.isFinite(sessionEnd)
    ? (status.periods || []).reduce((sum,p) => sum + Math.max(0, Math.min(clock,sessionEnd,Date.parse(p.end))-Math.max(lastClaim,Date.parse(p.start)))*0.000003,0) : 0;
  return {status, busy, message, active, pending, load};
}
'''

MODAL = r'''
      {showAmbassador && (
        <div className="fixed inset-0 z-[110] flex items-center justify-center bg-black/85 p-4" role="dialog" aria-modal="true" aria-label="APXN Ambassador">
          <div className="w-full max-w-sm rounded-3xl border border-emerald-700 bg-slate-950 p-5 text-white shadow-xl">
            <div className="flex items-center justify-between gap-2">
              <h2 className="text-lg font-black">💚 Become an APXN Ambassador</h2>
              <button type="button" onClick={() => setShowAmbassador(false)} className="p-2 text-slate-300" aria-label="Close">✕</button>
            </div>
            <p className="mt-2 text-sm text-slate-300">Add 💚 APXN to your Telegram profile name.</p>
            <div className="my-4 grid grid-cols-2 gap-2 rounded-xl bg-emerald-950/50 p-3 text-center">
              <div><b className="text-xl text-emerald-400">+5,000</b><p className="text-xs">One-time points</p></div>
              <div><b className="text-xl text-emerald-400">+0.003</b><p className="text-xs">Points / second</p></div>
            </div>
            <div className="flex items-center justify-between rounded-xl bg-slate-800 p-3">
              <strong>💚 APXN</strong><button type="button" className="rounded-lg bg-slate-700 px-3 py-2 text-sm" onClick={async () => { try { await navigator.clipboard.writeText('💚 APXN'); setAmbassadorCopied(true); } catch { setAmbassadorCopied(false); } }}>{ambassadorCopied ? 'Copied!' : 'Copy'}</button>
            </div>
            <p className="mt-3 text-xs text-slate-300">Edit your Telegram display name, then verify. Keep APXN in your name. Removal revokes the 5,000-point reward, the extra speed and all points earned from this program. The initial reward is not granted a second time.</p>
            {ambassador.status?.rewardEverGranted && <p className="mt-2 text-xs text-emerald-300">Conditional credited points: {Number(ambassador.status.credited || 0).toFixed(4)}</p>}
            <button type="button" disabled={ambassador.busy || !isDataLoaded} onClick={() => void ambassador.load(true)} className="mt-4 w-full rounded-xl bg-emerald-700 p-3 font-black disabled:opacity-50">{ambassador.busy ? 'Verifying…' : ambassador.active ? 'Verify APXN Name' : 'Verify & Activate Boost'}</button>
            {ambassador.message && <p className="mt-2 text-sm text-slate-200" role="status">{ambassador.message}</p>}
          </div>
        </div>
      )}
'''
BUTTON = r'''
          <button type="button" onClick={() => { setShowAmbassador(true); void ambassador.load(); }}
            className="min-w-0 flex-1 rounded-xl border border-emerald-500/50 bg-gradient-to-r from-emerald-800 to-green-700 px-2 py-2 text-center text-white active:scale-95">
            <span className="block text-xs font-black">{ambassador.active ? '💚 APXN Ambassador' : '💚 Add APXN'}</span>
            <span className="block text-[9px] font-bold text-emerald-100">{ambassador.active ? '+0.003/sec ACTIVE' : '+5,000 Points | +0.003/sec'}</span>
          </button>
'''


def replace_once(text, old, new, label):
    if text.count(old) != 1:
        raise RuntimeError(f'{label}: expected one matching anchor; found {text.count(old)}. No files written.')
    return text.replace(old, new, 1)


def prepare(root):
    page = root/'app/page.js'
    restart = root/'app/api/mining/restart/route.js'
    original = page.read_text(encoding='utf-8')
    r = restart.read_text(encoding='utf-8')
    if 'useAPXNAmbassador' in original or 'refreshAmbassador' in r:
        raise RuntimeError('Ambassador update appears already installed.')
    p = replace_once(original, 'export default function Home() {', HOOK+'\nexport default function Home() {', 'home')
    # Hooks require both userId and isDataLoaded. Insert before the first existing
    # return JSX (the stable state declaration below is after userId in this version).
    anchor = "  const [firstName, setFirstName] = useState('');"
    p = replace_once(p, anchor, anchor+'''
  const [showAmbassador, setShowAmbassador] = useState(false);
  const [ambassadorCopied, setAmbassadorCopied] = useState(false);
  const ambassador = useAPXNAmbassador(userId, isDataLoaded, (nextBalance) => {
    if (Number.isFinite(nextBalance)) { setBalance(nextBalance); patchUserCache(userId, { balance: nextBalance }); }
  });
''', 'ambassador hook')
    header = '        <div className="w-full flex justify-end items-center gap-2 mt-2">\n          <button\n            type="button"\n            onClick={handleOpenProfile}'
    p = replace_once(p,header, '        <div className="w-full flex justify-between items-center gap-2 mt-2">\n'+BUTTON+'          <button\n            type="button"\n            onClick={handleOpenProfile}', 'header next to profile')
    p = replace_once(p, '      {showWelcome && (', MODAL+'\n      {showWelcome && (', 'modal')
    p = replace_once(p, '                   totalMiningRate +\n                   (isStarsBoostActive', '                   totalMiningRate +\n                   (ambassador.active ? 0.003 : 0) +\n                   (isStarsBoostActive', 'display speed')
    p = replace_once(p, '+{miningDelta.toFixed(4)}', '+{(miningDelta + ambassador.pending).toFixed(4)}', 'display earned points')
    p = replace_once(p, '      setMiningDelta(0);\n\n      const returnedMiningSessionEndsAt', '      setMiningDelta(0);\n      void ambassador.load();\n\n      const returnedMiningSessionEndsAt', 'refresh after mining')
    # Existing restart is still allowed even if the new service or Telegram is temporarily unavailable.
    r = replace_once(r,"import { validateTelegramInitData } from '../../../../lib/telegram-auth';", "import { validateTelegramInitData } from '../../../../lib/telegram-auth';\nimport { refreshAmbassador } from '../../../../lib/apxn-ambassador';", 'restart import')
    anchor = "    const {\n      data,\n      error,\n    } =\n      await supabaseAdmin.rpc(\n        'apex_restart_mining_session',"
    r = replace_once(r,anchor,"    try { await refreshAmbassador(telegramId); } catch { /* Never block normal mining. */ }\n\n"+anchor,'restart verification')
    files = {page:p,restart:r,root/'lib/apxn-ambassador.js':SERVER,root/'app/api/ambassador/route.js':ROUTE,root/'apxn-ambassador-migration.sql':SQL}
    for path in list(files)[2:]:
        if path.exists(): raise RuntimeError(f'New file already exists: {path}')
    # Prevent a hook being inserted before the existing userId declaration.
    before_hook = p.split('const ambassador = useAPXNAmbassador(userId',1)[0]
    if 'const [userId,' not in before_hook: raise RuntimeError('userId declared after hook; review source manually.')
    return files


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--write', action='store_true', help='Create local changes only (use a test branch).')
    parser.add_argument('--sql', action='store_true', help='Print SQL for review, without editing source files.')
    parser.add_argument('--root', default='.', help='Path to Git repository checkout.')
    args=parser.parse_args()
    if args.sql: print(SQL); return
    root=Path(args.root).resolve()
    if not (root/'app/page.js').exists(): raise RuntimeError('Run from the repository root.')
    changes=prepare(root)
    print('Validated source anchors. Planned files:')
    for f in changes: print(' -', f.relative_to(root))
    if not args.write:
        print('Dry run only. No changes. Run with --write on a TEST branch to prepare the patch.'); return
    for f,body in changes.items():
        f.parent.mkdir(parents=True,exist_ok=True)
        f.write_text(body,encoding='utf-8')
    print('Local changes prepared. Review git diff and new files. Run npm build/tests.')
    print('Apply apxn-ambassador-migration.sql only to a TEST database first. No SQL or deployment has been performed.')

if __name__=='__main__':
    try: main()
    except Exception as exc: print('STOP:',exc,file=sys.stderr); sys.exit(1)
