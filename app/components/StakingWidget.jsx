'use client';

import { useEffect, useState } from 'react';

const MINIMUM_BALANCE = 20000;
const FIXED_AMOUNT = 10000;
const DAILY_REWARD = 1000;
const AD_WAIT_MS = 5000;
const AD_DISPLAY_TIMEOUT_MS = 90000;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function withTimeout(promise, milliseconds, reason) {
  let timer;
  try {
    return await Promise.race([
      Promise.resolve(promise),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(reason)), milliseconds);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

// Time limit applies to ad AVAILABILITY only. Once a real ad opens,
// closing or skipping it cannot be treated as an unavailable-ad fallback.
async function showStakingAd() {
  const started = Date.now();
  while (typeof window.show_11803132 !== 'function' && Date.now() - started < AD_WAIT_MS) {
    await sleep(100);
  }
  if (typeof window.show_11803132 !== 'function') return 'unavailable';

  const remaining = Math.max(1, AD_WAIT_MS - (Date.now() - started));
  try {
    await withTimeout(
      window.show_11803132({
        type: 'preload',
        timeout: Math.max(1, Math.ceil(remaining / 1000)),
        catchIfNoFeed: true,
      }),
      remaining,
      'STAKING_AD_UNAVAILABLE'
    );
  } catch {
    return 'unavailable';
  }

  try {
    await withTimeout(
      window.show_11803132({ type: 'end', catchIfNoFeed: true }),
      AD_DISPLAY_TIMEOUT_MS,
      'STAKING_AD_NOT_COMPLETED'
    );
    return 'completed';
  } catch (error) {
    // An explicitly empty ad feed may fall back; a skipped/closed
    // available ad must be retried rather than rewarded.
    if (/no.feed|no.fill|no.ads?|unavailable|no.inventory/i.test(String(error?.message || ''))) {
      return 'unavailable';
    }
    throw error;
  }
}

function countdown(seconds) {
  const value = Math.max(0, Math.floor(seconds));
  const h = Math.floor(value / 3600);
  const m = Math.floor((value % 3600) / 60);
  const s = value % 60;
  return [h, m, s].map((x) => String(x).padStart(2, '0')).join(':');
}

function getInitData() {
  return window.Telegram?.WebApp?.initData || '';
}

async function stakingRequest(action) {
  const initData = getInitData();
  if (!initData) throw new Error('Please open Apex Network inside Telegram.');

  const response = await fetch('/api/staking', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action, initData }),
    cache: 'no-store',
  });
  const data = await response.json();
  if (!response.ok && !data.errorCode) {
    throw new Error(data.error || 'Staking request failed. Please try again.');
  }
  return { ...data, httpOk: response.ok };
}

export default function StakingWidget({ userId, isDataLoaded, onBalanceUpdate, openStarsBoost }) {
  const [open, setOpen] = useState(false);
  const [info, setInfo] = useState(null);
  const [busy, setBusy] = useState(false);
  const [pendingAction, setPendingAction] = useState(null);
  const [adOutcome, setAdOutcome] = useState(null);
  const [errorMessage, setErrorMessage] = useState('');
  const [successMessage, setSuccessMessage] = useState('');
  const [tick, setTick] = useState(0);
  const [serverOffsetMs, setServerOffsetMs] = useState(0);

  useEffect(() => {
    setOpen(false);
    setInfo(null);
    setPendingAction(null);
    setErrorMessage('');
  }, [userId]);

  useEffect(() => {
    if (!open) return;
    const interval = setInterval(() => setTick((n) => n + 1), 1000);
    return () => clearInterval(interval);
  }, [open]);

  const remainingSeconds = info?.endsAt
    ? Math.max(0, Math.ceil((Date.parse(info.endsAt) - (Date.now() + serverOffsetMs)) / 1000))
    : 0;
  void tick; // The once-per-second state update keeps the countdown fresh.

  function syncInfo(data) {
    setInfo(data);
    if (data.serverNow) setServerOffsetMs(Date.parse(data.serverNow) - Date.now());
    if (Number.isFinite(Number(data.balance))) {
      onBalanceUpdate(Number(data.balance));
    }
  }

  async function openStaking() {
    if (!isDataLoaded || busy) return;
    setOpen(true);
    setBusy(true);
    setInfo(null);
    setPendingAction(null);
    setErrorMessage('');
    setSuccessMessage('');
    try {
      const result = await stakingRequest('status');
      syncInfo(result);
    } catch (error) {
      setErrorMessage(error?.message || 'Unable to load staking details.');
    } finally {
      setBusy(false);
    }
  }

  async function watchAdFor(action) {
    if (busy || pendingAction) return;
    setBusy(true);
    setErrorMessage('');
    setSuccessMessage('');
    try {
      const result = await showStakingAd();
      setAdOutcome(result);
      setPendingAction(action);
    } catch {
      setErrorMessage('The ad was not completed. Please try again.');
    } finally {
      setBusy(false);
    }
  }

  async function confirmStakingAction() {
    if (busy || !pendingAction) return;
    const action = pendingAction;
    setBusy(true);
    setErrorMessage('');
    try {
      const result = await stakingRequest(action);
      syncInfo(result);
      if (!result.httpOk || !result.success) {
        if (result.errorCode === 'NOT_ELIGIBLE') {
          setErrorMessage('Not eligible. You need at least 20,000 APXN POINTS.');
        } else if (result.errorCode === 'TOO_EARLY') {
          setErrorMessage('Your 24-hour staking cycle has not finished yet.');
        } else {
          setErrorMessage('Your staking status changed. Please review it and try again.');
        }
      } else if (action === 'claim') {
        setSuccessMessage('+1,000 APXN POINTS added to your balance! Start a new cycle when ready.');
      } else {
        setSuccessMessage('Staking activated! Your 24-hour countdown has started.');
      }
    } catch (error) {
      setErrorMessage(error?.message || 'Staking could not be completed.');
    } finally {
      setPendingAction(null);
      setAdOutcome(null);
      setBusy(false);
    }
  }

  function closeStaking() {
    if (!busy) {
      setOpen(false);
      setPendingAction(null);
      setAdOutcome(null);
      setErrorMessage('');
    }
  }

  const hasActiveCycle = info?.status === 'active';
  const eligible = Number(info?.balance || 0) >= MINIMUM_BALANCE;
  const notEligible = Boolean(info && !hasActiveCycle && !eligible);
  const action = hasActiveCycle
    ? (remainingSeconds === 0 ? 'claim' : null)
    : (eligible ? 'activate' : null);
  const actionLabel = hasActiveCycle
    ? 'CLAIM +1,000 APXN • WATCH AD'
    : info?.status === 'claimed' ? 'STAKE AGAIN • WATCH AD' : 'CONFIRM STAKING • WATCH AD';

  return (
    <>
      <button
        type="button"
        onClick={openStaking}
        disabled={!isDataLoaded}
        className="absolute right-1 top-1 -translate-y-12 z-20 flex h-16 w-16 flex-col items-center justify-center rounded-full border-2 border-emerald-300/80 bg-gradient-to-br from-emerald-500 via-teal-600 to-violet-700 text-white shadow-[0_0_24px_rgba(16,185,129,0.6)] transition-transform active:scale-95 disabled:opacity-60"
        aria-label="Open APXN Staking"
      >
        <span className="text-xl leading-5">🔒</span>
        <span className="text-[10px] font-black tracking-tight">Staking</span>
      </button>

      {open && (
        <div className="fixed inset-0 z-[290] flex items-center justify-center overflow-y-auto bg-black/85 p-4 backdrop-blur-md">
          <div className="relative w-full max-w-sm rounded-[28px] border border-emerald-400/50 bg-slate-950 px-5 py-6 text-center text-white shadow-[0_0_45px_rgba(16,185,129,0.22)]">
            <button
              type="button"
              onClick={closeStaking}
              disabled={busy}
              className="absolute right-4 top-3 text-xl text-slate-400 disabled:opacity-40"
              aria-label="Close Staking"
            >
              ✕
            </button>

            <div className="mx-auto mb-3 flex h-16 w-16 items-center justify-center rounded-full border border-emerald-300/70 bg-emerald-500/15 text-3xl">
              {notEligible ? '🔐' : '💎'}
            </div>
            <h2 className="text-xl font-black">APXN STAKING</h2>

            {!info && (
              <div className="mt-5">
                <p className="text-sm text-slate-300">{busy ? 'Checking your APXN balance...' : errorMessage || 'Unable to load staking.'}</p>
                {!busy && <button type="button" onClick={openStaking} className="mt-4 w-full rounded-xl bg-emerald-600 py-3 font-bold">TRY AGAIN</button>}
              </div>
            )}

            {info && (
              <div className="mt-4 space-y-4">
                {notEligible ? (
                  <>
                    <div className="rounded-xl border border-amber-500/40 bg-amber-500/10 p-4">
                      <div className="text-lg font-black text-amber-300">NOT ELIGIBLE</div>
                      <p className="mt-2 text-xs text-slate-300">You need at least 20,000 APXN POINTS to unlock Staking.</p>
                      <p className="mt-3 text-2xl font-black text-amber-300">20,000 APXN</p>
                      <p className="mt-1 text-[11px] text-slate-400">Your balance: {Number(info.balance || 0).toLocaleString()}</p>
                    </div>
                    <button
                      type="button"
                      onClick={() => { closeStaking(); openStarsBoost(); }}
                      className="w-full rounded-xl bg-gradient-to-r from-violet-600 to-fuchsia-600 px-3 py-3 font-black"
                    >
                      ⭐ OPEN 10 ⭐ MINING BOOST
                    </button>
                  </>
                ) : (
                  <>
                    <div className="grid grid-cols-2 gap-3">
                      <div className="rounded-xl border border-emerald-500/30 bg-slate-900 p-3">
                        <div className="text-[10px] text-slate-400">FIXED STAKING</div>
                        <div className="mt-1 text-xl font-black">{FIXED_AMOUNT.toLocaleString()}</div>
                        <div className="text-[10px] text-emerald-300">APXN POINTS</div>
                      </div>
                      <div className="rounded-xl border border-emerald-500/30 bg-slate-900 p-3">
                        <div className="text-[10px] text-slate-400">24H REWARD</div>
                        <div className="mt-1 text-xl font-black text-emerald-300">+{DAILY_REWARD.toLocaleString()}</div>
                        <div className="text-[10px] text-emerald-300">APXN POINTS</div>
                      </div>
                    </div>
                    <p className="text-xs leading-5 text-slate-300">Your 10,000 APXN POINTS remain in your balance. No points are deducted or locked.</p>

                    {hasActiveCycle && (
                      <div className="rounded-xl border border-cyan-400/40 bg-cyan-400/10 px-3 py-4">
                        <p className="text-xs font-black text-cyan-300">
                          {remainingSeconds > 0 ? 'STAKING ACTIVE • TIME REMAINING' : 'YOUR REWARD IS READY'}
                        </p>
                        <p className="mt-1 text-3xl font-black tabular-nums">{countdown(remainingSeconds)}</p>
                        <p className="mt-2 text-xs text-slate-300">Cycle #{info.cycleNumber}</p>
                      </div>
                    )}

                    {info.status === 'claimed' && (
                      <p className="rounded-xl border border-emerald-400/40 bg-emerald-400/10 p-3 text-sm font-bold text-emerald-300">Your previous cycle was claimed. You can start a new 24-hour cycle.</p>
                    )}

                    {pendingAction ? (
                      <>
                        <p className="text-xs text-emerald-300">
                          {adOutcome === 'unavailable'
                            ? 'Ad unavailable after 5 seconds. You can continue.'
                            : 'Ad completed. Confirm to continue.'}
                        </p>
                        <button type="button" onClick={confirmStakingAction} disabled={busy} className="w-full rounded-xl bg-gradient-to-r from-emerald-500 to-teal-600 py-3 text-lg font-black disabled:opacity-60">
                          {busy ? 'PLEASE WAIT...' : 'OK'}
                        </button>
                      </>
                    ) : action ? (
                      <button type="button" onClick={() => watchAdFor(action)} disabled={busy} className="w-full rounded-xl bg-gradient-to-r from-emerald-500 to-violet-600 py-3 text-sm font-black disabled:opacity-60">
                        {busy ? 'CHECKING / WATCHING AD...' : actionLabel}
                      </button>
                    ) : (
                      <p className="text-sm font-bold text-emerald-300">Come back when the 24-hour timer ends to claim +1,000 APXN.</p>
                    )}
                  </>
                )}

                {successMessage && <p role="status" className="text-xs font-bold text-emerald-300">✅ {successMessage}</p>}
                {errorMessage && <p role="alert" className="text-xs font-bold text-red-300">⚠️ {errorMessage}</p>}
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}

