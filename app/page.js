"use client";
import { useState, useEffect, useRef } from 'react';
import Image from 'next/image';
import { supabase } from '../lib/supabase';
import StakingWidget from './components/StakingWidget';

const MINING_SESSION_DURATION_SECONDS = 24 * 60 * 60;
const AD_REWARD_COOLDOWN_SECONDS = 24 * 60 * 60;
const DAILY_TASK_COOLDOWN_SECONDS = 24 * 60 * 60;
const MINING_BOOST_DURATION_SECONDS = 24 * 60 * 60;
// Only new Telegram Stars invoices earn 5,000 POINTS.
// Previously purchased 10,000 POINTS boosts use their own recorded events.
const STARS_BOOST_REWARD_POINTS = 5000;
const USER_CACHE_VERSION = 5;
const USER_CACHE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

// Render a country flag using the saved two-letter country code.
// Unknown countries get a globe; no Telegram username is displayed.
function top20CountryFlag(code) {
  const country = String(code || '').trim().toUpperCase();
  if (!/^[A-Z]{2}$/.test(country) || ['XX', 'EU', 'T1'].includes(country)) {
    return '🌍';
  }
  return String.fromCodePoint(
    ...Array.from(country, (letter) => 127397 + letter.charCodeAt(0))
  );
}


// Mining restart ad availability is checked for every country for at most 5 seconds.
// If no ad can be prepared in that window, mining continues through ad_unavailable mode.
// Once an ad is available and starts, skipping/rejecting it must NOT trigger the fallback.
const MINING_RESTART_AD_TIMEOUT_MS = 90 * 1000;
const MINING_RESTART_AD_WAIT_MS = 5 * 1000;

async function prepareMiningRestartAd() {
  const startedAt = Date.now();

  // Give the Monetag SDK part of the same 5-second window to become ready.
  while (
    typeof window.show_11803132 !== 'function' &&
    Date.now() - startedAt < MINING_RESTART_AD_WAIT_MS
  ) {
    await new Promise(resolve => window.setTimeout(resolve, 100));
  }

  if (typeof window.show_11803132 !== 'function') {
    return false;
  }

  let timeoutId;

  try {
    const remainingMs = Math.max(
      1,
      MINING_RESTART_AD_WAIT_MS - (Date.now() - startedAt)
    );

    // Preload checks ad availability without opening the visible ad.
    await Promise.race([
      Promise.resolve().then(() =>
        window.show_11803132({
          type: 'preload',
          timeout: Math.max(
            1,
            Math.ceil(remainingMs / 1000)
          ),
          catchIfNoFeed: true,
        })
      ),
      new Promise((_, reject) => {
        timeoutId = window.setTimeout(() => {
          reject(
            new Error('MINING_RESTART_AD_UNAVAILABLE')
          );
        }, remainingMs);
      }),
    ]);

    return true;
  } catch (error) {
    console.warn(
      'Mining restart ad unavailable:',
      error?.message || error
    );

    return false;
  } finally {
    if (timeoutId !== undefined) {
      window.clearTimeout(timeoutId);
    }
  }
}

async function showMiningRestartAdSafely() {
  let timeoutId;

  try {
    // At this point preload has succeeded.
    // A visible ad must complete normally. A skip/rejection is propagated
    // to handleClaim and must never become ad_unavailable.
    await Promise.race([
      Promise.resolve().then(() =>
        window.show_11803132({
          type: 'end',
          catchIfNoFeed: true,
        })
      ),
      new Promise((_, reject) => {
        timeoutId = window.setTimeout(() => {
          reject(
            new Error('MINING_RESTART_AD_TIMEOUT')
          );
        }, MINING_RESTART_AD_TIMEOUT_MS);
      }),
    ]);
  } finally {
    if (timeoutId !== undefined) {
      window.clearTimeout(timeoutId);
    }
  }
}

function getRemainingAdRewardCooldown(lastAdRewardAt) {
  if (!lastAdRewardAt) return 0;

  const lastTime = new Date(lastAdRewardAt).getTime();

  if (!Number.isFinite(lastTime)) return 0;

  const elapsedSeconds = Math.max(
    0,
    (Date.now() - lastTime) / 1000
  );

  if (elapsedSeconds >= AD_REWARD_COOLDOWN_SECONDS) {
    return 0;
  }

  return Math.ceil(
    AD_REWARD_COOLDOWN_SECONDS - elapsedSeconds
  );
}

function getRemainingDailyTaskCooldown(
  lastTaskAt,
  nowTime = Date.now()
) {
  if (!lastTaskAt) return 0;

  const lastTime =
    new Date(lastTaskAt).getTime();

  const safeNowTime =
    Number.isFinite(Number(nowTime))
      ? Number(nowTime)
      : Date.now();

  if (!Number.isFinite(lastTime)) {
    return 0;
  }

  const elapsedSeconds = Math.max(
    0,
    (safeNowTime - lastTime) / 1000
  );

  if (
    elapsedSeconds >=
    DAILY_TASK_COOLDOWN_SECONDS
  ) {
    return 0;
  }

  return Math.ceil(
    DAILY_TASK_COOLDOWN_SECONDS -
    elapsedSeconds
  );
}

function getMiningSessionEndsAt(
  miningSessionEndsAt,
  lastClaim = null
) {
  const independentEndTime =
    miningSessionEndsAt
      ? new Date(
          miningSessionEndsAt
        ).getTime()
      : NaN;

  if (
    Number.isFinite(
      independentEndTime
    )
  ) {
    return independentEndTime;
  }

  // Compatibility fallback only.
  // Authoritative Bootstrap/Register data provides
  // miningSessionEndsAt independently from lastClaim.
  if (!lastClaim) {
    return null;
  }

  const lastClaimTime =
    new Date(
      lastClaim
    ).getTime();

  if (
    !Number.isFinite(
      lastClaimTime
    )
  ) {
    return null;
  }

  return (
    lastClaimTime +
    MINING_SESSION_DURATION_SECONDS * 1000
  );
}

function getRemainingMiningSession(
  miningSessionEndsAt,
  lastClaim = null
) {
  const endsAt =
    getMiningSessionEndsAt(
      miningSessionEndsAt,
      lastClaim
    );

  if (!Number.isFinite(endsAt)) {
    return 0;
  }

  const remainingSeconds =
    (endsAt - Date.now()) / 1000;

  if (remainingSeconds <= 0) {
    return 0;
  }

  return Math.ceil(
    remainingSeconds
  );
}

function getRemainingMiningBoost(boostUntil) {
  if (!boostUntil) return 0;

  const untilTime = new Date(boostUntil).getTime();

  if (!Number.isFinite(untilTime)) return 0;

  const remainingSeconds =
    (untilTime - Date.now()) / 1000;

  if (remainingSeconds <= 0) return 0;

  return Math.ceil(remainingSeconds);
}

function getRemainingStarsBoost(
  boostUntil,
  nowTime = Date.now()
) {
  if (!boostUntil) return 0;

  const untilTime =
    new Date(boostUntil).getTime();

  const safeNowTime =
    Number.isFinite(Number(nowTime))
      ? Number(nowTime)
      : Date.now();

  if (!Number.isFinite(untilTime)) {
    return 0;
  }

  return Math.max(
    0,
    Math.ceil(
      (untilTime - safeNowTime) / 1000
    )
  );
}

function getEventAwareMiningBoostRemaining({
  boostStartedAt,
  boostUntil,
  eventStartsAt,
  eventEndsAt,
  nowTime,
}) {
  if (!boostStartedAt || !boostUntil) return 0;

  const boostStartTime =
    new Date(boostStartedAt).getTime();

  const boostUntilTime =
    new Date(boostUntil).getTime();

  const eventStartTime = eventStartsAt
    ? new Date(eventStartsAt).getTime()
    : NaN;

  const eventEndTime = eventEndsAt
    ? new Date(eventEndsAt).getTime()
    : NaN;

  const safeNowTime = Number(nowTime);

  if (
    !Number.isFinite(boostStartTime) ||
    !Number.isFinite(boostUntilTime) ||
    !Number.isFinite(safeNowTime) ||
    boostUntilTime <= boostStartTime
  ) {
    return 0;
  }

  if (
    Number.isFinite(eventStartTime) &&
    Number.isFinite(eventEndTime) &&
    eventEndTime > eventStartTime &&
    boostStartTime < eventStartTime &&
    boostUntilTime > eventStartTime
  ) {
    const savedSeconds = Math.max(
      0,
      (boostUntilTime - eventStartTime) / 1000
    );

    if (safeNowTime < eventStartTime) {
      return Math.max(
        0,
        Math.ceil(
          (boostUntilTime - safeNowTime) / 1000
        )
      );
    }

    if (safeNowTime < eventEndTime) {
      return Math.max(
        0,
        Math.ceil(savedSeconds)
      );
    }

    const resumedUntilTime =
      eventEndTime + savedSeconds * 1000;

    return Math.max(
      0,
      Math.ceil(
        (resumedUntilTime - safeNowTime) / 1000
      )
    );
  }

  return Math.max(
    0,
    Math.ceil(
      (boostUntilTime - safeNowTime) / 1000
    )
  );
}

function getEffectiveMiningRate(
  baseRate,
  activeFriends,
  boostActive
) {
  const safeBaseRate = Number(baseRate || 0.00025);
  const safeActiveFriends = Math.max(
    0,
    Number(activeFriends || 0)
  );

  const referralRate =
    safeActiveFriends *
    (safeBaseRate * 0.05);

  return boostActive
    ? safeBaseRate * 3 + referralRate
    : safeBaseRate + referralRate;
}

function getOverlapSeconds(
  rangeStart,
  rangeEnd,
  segmentStart,
  segmentEnd
) {
  if (
    !Number.isFinite(rangeStart) ||
    !Number.isFinite(rangeEnd) ||
    !Number.isFinite(segmentStart) ||
    !Number.isFinite(segmentEnd)
  ) {
    return 0;
  }

  const overlapStart = Math.max(
    rangeStart,
    segmentStart
  );

  const overlapEnd = Math.min(
    rangeEnd,
    segmentEnd
  );

  if (overlapEnd <= overlapStart) {
    return 0;
  }

  return (
    overlapEnd - overlapStart
  ) / 1000;
}

// Paid boost events come from the authenticated /api/stars/boost/status endpoint.
// Each interval has its own reward_total, so existing 10k purchases retain
// their full rate even after the new 5k offer goes live.
function getActiveStarsBoostRate(events, nowTime = Date.now()) {
  if (!Array.isArray(events)) return 0;
  return events.reduce((rate, event) => {
    const start = Date.parse(event.startedAt);
    const end = Date.parse(event.endsAt);
    const amount = Number(event.rewardTotal);
    if (!Number.isFinite(start) || !Number.isFinite(end) ||
        !Number.isFinite(amount) || end <= start || amount <= 0 ||
        nowTime < start || nowTime >= end) return rate;
    return rate + amount / ((end - start) / 1000);
  }, 0);
}

function getActiveStarsBoostReward(events, nowTime = Date.now()) {
  if (!Array.isArray(events)) return 0;
  return events.reduce((total, event) => {
    const start = Date.parse(event.startedAt);
    const end = Date.parse(event.endsAt);
    const amount = Number(event.rewardTotal);
    return Number.isFinite(start) && Number.isFinite(end) &&
      nowTime >= start && nowTime < end && Number.isFinite(amount)
      ? total + amount : total;
  }, 0);
}

async function fetchStarsBoostEvents() {
  const initData = window.Telegram?.WebApp?.initData;
  if (!initData) throw new Error('Telegram authentication unavailable');
  const response = await fetch('/api/stars/boost/status', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ initData }),
    cache: 'no-store',
  });
  if (!response.ok) throw new Error('Paid boost status unavailable');
  const data = await response.json();
  if (!data?.success || !Array.isArray(data.events)) {
    throw new Error('Invalid paid boost response');
  }
  return data.events.filter((event) => {
    const start = Date.parse(event.startedAt);
    const end = Date.parse(event.endsAt);
    return Number.isFinite(start) && Number.isFinite(end) && end > start &&
      [5000, 10000].includes(Number(event.rewardTotal));
  });
}

function calculateEstimatedMiningDelta({
  lastClaim,
  miningSessionEndsAt = null,
  baseRate,
  activeFriends,
  boostStartedAt,
  boostUntil,
  eventStartsAt = null,
  eventEndsAt = null,
  eventBaseRate = 0.02,
  starsBoostStartedAt = null,
  starsBoostUntil = null,
  starsBoostEvents = [],
  nowTime = Date.now(),
}) {
  if (!lastClaim) return 0;

  const lastClaimTime =
    new Date(lastClaim).getTime();

  const safeNowTime = Number(nowTime);

  if (
    !Number.isFinite(lastClaimTime) ||
    !Number.isFinite(safeNowTime)
  ) {
    return 0;
  }

  const sessionEndTime =
    getMiningSessionEndsAt(
      miningSessionEndsAt,
      lastClaim
    );

  const accrualEndTime = Math.min(
    safeNowTime,
    Number.isFinite(
      sessionEndTime
    )
      ? sessionEndTime
      : lastClaimTime +
          MINING_SESSION_DURATION_SECONDS * 1000
  );

  const elapsedSeconds = Math.max(
    0,
    (accrualEndTime - lastClaimTime) / 1000
  );

  const safeBaseRate = Number(
    baseRate || 0.00025
  );

  const safeEventBaseRate = Number(
    eventBaseRate || 0.02
  );

  const safeActiveFriends = Math.max(
    0,
    Number(activeFriends || 0)
  );

  const normalRate = getEffectiveMiningRate(
    safeBaseRate,
    safeActiveFriends,
    false
  );

  const boostedRate = getEffectiveMiningRate(
    safeBaseRate,
    safeActiveFriends,
    true
  );

  const eventRate = getEffectiveMiningRate(
    safeEventBaseRate,
    safeActiveFriends,
    false
  );

  const eventStartTime = eventStartsAt
    ? new Date(eventStartsAt).getTime()
    : NaN;

  const eventEndTime = eventEndsAt
    ? new Date(eventEndsAt).getTime()
    : NaN;

  const hasValidEvent =
    Number.isFinite(eventStartTime) &&
    Number.isFinite(eventEndTime) &&
    eventEndTime > eventStartTime;

  let eventSeconds = 0;

  if (hasValidEvent) {
    eventSeconds = getOverlapSeconds(
      lastClaimTime,
      accrualEndTime,
      eventStartTime,
      eventEndTime
    );
  }

  const boostStartTime = boostStartedAt
    ? new Date(boostStartedAt).getTime()
    : NaN;

  const boostUntilTime = boostUntil
    ? new Date(boostUntil).getTime()
    : NaN;

  let boostedSeconds = 0;

  if (
    Number.isFinite(boostStartTime) &&
    Number.isFinite(boostUntilTime) &&
    boostUntilTime > boostStartTime
  ) {
    const boostSegments = [];

    if (
      hasValidEvent &&
      boostStartTime < eventStartTime &&
      boostUntilTime > eventStartTime
    ) {
      boostSegments.push([
        boostStartTime,
        Math.min(
          boostUntilTime,
          eventStartTime
        ),
      ]);

      boostSegments.push([
        eventEndTime,
        eventEndTime +
          (boostUntilTime - eventStartTime),
      ]);
    } else if (
      hasValidEvent &&
      boostStartTime >= eventStartTime &&
      boostStartTime < eventEndTime
    ) {
      // x3 cannot be activated during the event.
      // Ignore any stale/historical interval that starts inside it.
    } else {
      boostSegments.push([
        boostStartTime,
        boostUntilTime,
      ]);
    }

    for (const [segmentStart, segmentEnd] of boostSegments) {
      let seconds = getOverlapSeconds(
        lastClaimTime,
        accrualEndTime,
        segmentStart,
        segmentEnd
      );

      if (
        hasValidEvent &&
        seconds > 0
      ) {
        const eventOverlap = getOverlapSeconds(
          Math.max(
            lastClaimTime,
            segmentStart
          ),
          Math.min(
            accrualEndTime,
            segmentEnd
          ),
          eventStartTime,
          eventEndTime
        );

        seconds = Math.max(
          0,
          seconds - eventOverlap
        );
      }

      boostedSeconds += seconds;
    }
  }

  boostedSeconds = Math.min(
    Math.max(
      0,
      elapsedSeconds - eventSeconds
    ),
    Math.max(
      0,
      boostedSeconds
    )
  );

  const normalSeconds = Math.max(
    0,
    elapsedSeconds -
      eventSeconds -
      boostedSeconds
  );

  // Server-calculated mining claims already use each paid boost event's
  // reward_total. Mirror that logic in the visible balance estimate.
  // Never infer all historical purchases from the NEW 5k rate.
  const starsBoostDelta = Array.isArray(starsBoostEvents)
    ? starsBoostEvents.reduce((sum, event) => {
        const start = Date.parse(event.startedAt);
        const end = Date.parse(event.endsAt);
        const amount = Number(event.rewardTotal);
        if (!Number.isFinite(start) || !Number.isFinite(end) ||
            !Number.isFinite(amount) || amount <= 0 || end <= start) {
          return sum;
        }
        const overlap = getOverlapSeconds(
          lastClaimTime, safeNowTime, start, end
        );
        return sum + overlap * (amount / ((end - start) / 1000));
      }, 0)
    : 0;

  return (
    normalSeconds * normalRate +
    boostedSeconds * boostedRate +
    eventSeconds * eventRate +
    starsBoostDelta
  );
}

function getUserCacheKey(telegramId) {
  return `apex_user_v${USER_CACHE_VERSION}_${telegramId}`;
}

function readUserCache(telegramId) {
  if (typeof window === 'undefined' || !telegramId) return null;

  try {
    const raw = window.localStorage.getItem(getUserCacheKey(telegramId));
    if (!raw) return null;

    const cached = JSON.parse(raw);

    if (
      cached?.version !== USER_CACHE_VERSION ||
      cached?.telegramId !== String(telegramId) ||
      !cached?.savedAt ||
      Date.now() - Number(cached.savedAt) > USER_CACHE_MAX_AGE_MS
    ) {
      window.localStorage.removeItem(getUserCacheKey(telegramId));
      return null;
    }

    return cached;
  } catch {
    return null;
  }
}

function writeUserCache(telegramId, data) {
  if (typeof window === 'undefined' || !telegramId) return;

  try {
    window.localStorage.setItem(
      getUserCacheKey(telegramId),
      JSON.stringify({
        ...data,
        version: USER_CACHE_VERSION,
        telegramId: String(telegramId),

        // savedAt represents the last authoritative
        // Bootstrap/Register synchronization.
        //
        // Local actions must never extend this timestamp.
        savedAt: Date.now(),
      })
    );
  } catch {
    // Local cache is only a performance optimization.
  }
}

function patchUserCache(telegramId, patch) {
  if (typeof window === 'undefined' || !telegramId) return;

  // Only patch a still-valid full cache.
  //
  // If the cache already expired, do NOT create a new
  // partial cache from a local action. The next app open
  // will perform one authoritative Bootstrap instead.
  const current = readUserCache(telegramId);

  if (!current) return;

  try {
    window.localStorage.setItem(
      getUserCacheKey(telegramId),
      JSON.stringify({
        ...current,
        ...patch,
        version: USER_CACHE_VERSION,
        telegramId: String(telegramId),

        // Preserve the original synchronization time.
        savedAt: current.savedAt,
      })
    );
  } catch {
    // Local cache is only a performance optimization.
  }
}

export default function Home() {
  const [balance, setBalance] = useState(0);
  const [isDataLoaded, setIsDataLoaded] = useState(false);
  const [miningDelta, setMiningDelta] = useState(0);
  const [miningSessionRemaining, setMiningSessionRemaining] =
    useState(MINING_SESSION_DURATION_SECONDS);
  const [miningSessionEndsAt, setMiningSessionEndsAt] =
    useState(null);
  const [isWatchingRestartAd, setIsWatchingRestartAd] = useState(false);
  const [activeTab, setActiveTab] = useState('mine');
  const [miningCountry, setMiningCountry] = useState('');

  // APXN Profile is isolated from mining, tasks, ads and payment state.
  const [showProfile, setShowProfile] = useState(false);
  const [hasEarlyAccessBadge, setHasEarlyAccessBadge] = useState(false);
  const [profileBadgeChecked, setProfileBadgeChecked] = useState(false);
  const [profileBadgeLoading, setProfileBadgeLoading] = useState(false);

  const [discoverView, setDiscoverView] = useState('about');

  const [taskCompleted, setTaskCompleted] = useState(false);
  const [groupTaskCompleted, setGroupTaskCompleted] = useState(false);
  const [twitterTaskCompleted, setTwitterTaskCompleted] = useState(false);

  // Links arrive with the existing /api/bootstrap response from
  // Cloudflare WORKER RUNTIME variables; never inline them at build time.
  const [dailyTwitterLink, setDailyTwitterLink] = useState('');
  const [dailyTelegramLink, setDailyTelegramLink] = useState('');

  const [dailyTwitterDone, setDailyTwitterDone] = useState(false);
  const [dailyTelegramDone, setDailyTelegramDone] = useState(false);
  const [dailyTwitterCooldown, setDailyTwitterCooldown] = useState(0);
  const [dailyTelegramCooldown, setDailyTelegramCooldown] = useState(0);
  const [verifyingTwitter, setVerifyingTwitter] = useState(false);
  const [verifyingTelegram, setVerifyingTelegram] = useState(false);

  // Three-step task flow:
  // GO -> CONFIRM -> CONFIRM AGAIN -> server reward.
  // The first two steps are local only, so they add no Supabase load.
  const [taskConfirmStages, setTaskConfirmStages] = useState({
    dailyTelegram: 0,
    dailyTwitter: 0,
    channel: 0,
    group: 0,
    twitter: 0,
  });

  const [adRewardCooldown, setAdRewardCooldown] = useState(0);
  const [isWatchingAd, setIsWatchingAd] = useState(false);
  const [isAdRewardStatusLoaded, setIsAdRewardStatusLoaded] = useState(false);

  const [miningBoostStartedAt, setMiningBoostStartedAt] = useState(null);
  const [miningBoostUntil, setMiningBoostUntil] = useState(null);
  const [miningBoostRemaining, setMiningBoostRemaining] = useState(0);
  const [isWatchingBoostAd, setIsWatchingBoostAd] = useState(false);
  const [isMiningBoostStatusLoaded, setIsMiningBoostStatusLoaded] = useState(false);

  const [starsBoostStartedAt, setStarsBoostStartedAt] = useState(null);
  const [starsBoostUntil, setStarsBoostUntil] = useState(null);
  const [starsBoostRemaining, setStarsBoostRemaining] = useState(0);
  const [starsBoostEvents, setStarsBoostEvents] = useState([]);
  const starsBoostEventsRef = useRef([]);
  const [starsBoostStatusLoaded, setStarsBoostStatusLoaded] = useState(false);
  const [showStarsBoostModal, setShowStarsBoostModal] = useState(false);
  const [isBuyingStarsBoost, setIsBuyingStarsBoost] = useState(false);

  const [miningEventStatusLoaded, setMiningEventStatusLoaded] = useState(false);
  const [miningEventPhase, setMiningEventPhase] = useState('unknown');
  const [miningEventRemaining, setMiningEventRemaining] = useState(0);
  const [miningEventStartsIn, setMiningEventStartsIn] = useState(0);
  const [miningEventStartsAt, setMiningEventStartsAt] = useState(null);
  const [miningEventEndsAt, setMiningEventEndsAt] = useState(null);
  const [miningEventBaseRate, setMiningEventBaseRate] = useState(0.02);
  const [miningEventBoostEnabled, setMiningEventBoostEnabled] = useState(true);
  const [miningEventServerNowMs, setMiningEventServerNowMs] = useState(null);
  const [miningEventClockElapsed, setMiningEventClockElapsed] = useState(0);

  const [checkinStreak, setCheckinStreak] = useState(0);
  const [activeDays, setActiveDays] = useState(0);
  const [checkinRecoveryDays, setCheckinRecoveryDays] = useState(2);
  const [checkinRewardEligible, setCheckinRewardEligible] = useState(true);
  const [dailyCheckinV2Enabled, setDailyCheckinV2Enabled] = useState(false);
  const [canCheckIn, setCanCheckIn] = useState(false);
  const [dailyRewardAmt, setDailyRewardAmt] = useState(100);
  const [friendsCount, setFriendsCount] = useState(0);
  const [activeFriendsCount, setActiveFriendsCount] = useState(0);
  const [friendsList, setFriendsList] = useState([]);
  const [friendsLoaded, setFriendsLoaded] = useState(false);
  const [referralSummaryLoaded, setReferralSummaryLoaded] = useState(false);

  const [dbMiningRate, setDbMiningRate] = useState(0.00025);
  const [totalMiningRate, setTotalMiningRate] = useState(0.00025);

  const [userId, setUserId] = useState(null);
  const [firstName, setFirstName] = useState('');
  const [userName, setUserName] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [showWelcome, setShowWelcome] = useState(false);
  const [welcomeAmount, setWelcomeAmount] = useState(0);
  const [referralBonusAmount, setReferralBonusAmount] = useState(0);

  const [showTop20, setShowTop20] = useState(false);
  const [top20Users, setTop20Users] = useState([]);
  const [top20Month, setTop20Month] = useState('');
  const [top20Loading, setTop20Loading] = useState(false);
  const [top20Error, setTop20Error] = useState('');
  const [bscWalletInput, setBscWalletInput] = useState('');
  const [savedBscWallet, setSavedBscWallet] = useState('');
  const [walletVerified, setWalletVerified] = useState(false);
  const [bscWalletCanEdit, setBscWalletCanEdit] = useState(true);
  const [bscWalletNextEditDate, setBscWalletNextEditDate] = useState(null);
  const [bscWalletLoaded, setBscWalletLoaded] = useState(false);
  const [bscWalletLoading, setBscWalletLoading] = useState(false);
  const [bscWalletMessage, setBscWalletMessage] = useState('');
  // Open the correct Mini App section from Telegram notification buttons.
  // Navigation only: this does not change balances, mining, or payment state.
  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }

    const params = new URLSearchParams(
      window.location.search
    );

    const tab = params.get('tab');

    if (
      [
        'mine',
        'tasks',
        'friends',
        'boosts',
        'discover',
      ].includes(tab)
    ) {
      setActiveTab(tab);
    }

    if (params.get('offer') === 'stars48') {
      setActiveTab('mine');
      setShowStarsBoostModal(true);
    }
  }, []);


  const isMiningEventActive =
    miningEventStatusLoaded &&
    miningEventPhase === 'active';

  const effectiveBaseMiningRate =
    isMiningEventActive
      ? miningEventBaseRate
      : dbMiningRate;

  const isMiningBoostActive =
    miningBoostRemaining > 0 &&
    !isMiningEventActive;

  const hasFrozenMiningBoost =
    isMiningEventActive &&
    miningBoostRemaining > 0;

  const isStarsBoostActive =
    starsBoostRemaining > 0;

  const activeStarsBoostRate = starsBoostStatusLoaded
    ? getActiveStarsBoostRate(starsBoostEvents)
    : 0;
  const activeStarsBoostReward = starsBoostStatusLoaded
    ? getActiveStarsBoostReward(starsBoostEvents)
    : 0;
  const visibleStarsBoostReward = isStarsBoostActive
    ? (activeStarsBoostReward > 0
        ? `${activeStarsBoostReward.toLocaleString('en-US')} APXN POINTS`
        : 'APXN POINTS BOOST')
    : `${STARS_BOOST_REWARD_POINTS.toLocaleString('en-US')} APXN POINTS`;

  const isMiningPaused =
    isDataLoaded &&
    miningSessionRemaining <= 0;

  const getAuthoritativeNowTime = () => {
    if (
      Number.isFinite(
        Number(miningEventServerNowMs)
      )
    ) {
      return (
        Number(miningEventServerNowMs) +
        Number(miningEventClockElapsed || 0) * 1000
      );
    }

    return Date.now();
  };

  const applyMiningEventState = (eventData) => {
    if (!eventData) return;

    const serverNowTime = eventData.serverNow
      ? new Date(eventData.serverNow).getTime()
      : NaN;

    const startsAtTime = eventData.startsAt
      ? new Date(eventData.startsAt).getTime()
      : NaN;

    const endsAtTime = eventData.endsAt
      ? new Date(eventData.endsAt).getTime()
      : NaN;

    let phase = 'ended';

    if (Boolean(eventData.active)) {
      phase = 'active';
    } else if (
      Number.isFinite(serverNowTime) &&
      Number.isFinite(startsAtTime) &&
      serverNowTime < startsAtTime
    ) {
      phase = 'before';
    }

    setMiningEventPhase(phase);
    setMiningEventStartsAt(eventData.startsAt || null);
    setMiningEventEndsAt(eventData.endsAt || null);
    setMiningEventBaseRate(
      Number(eventData.baseRate || 0.02)
    );
    setMiningEventBoostEnabled(
      Boolean(eventData.boostEnabled)
    );
    setMiningEventRemaining(
      phase === 'active'
        ? Math.max(
            0,
            Number(eventData.remainingSeconds || 0)
          )
        : 0
    );
    setMiningEventStartsIn(
      phase === 'before'
        ? Math.max(
            0,
            Number(eventData.secondsUntilStart || 0)
          )
        : 0
    );

    if (Number.isFinite(serverNowTime)) {
      setMiningEventServerNowMs(serverNowTime);
      setMiningEventClockElapsed(0);
    }

    setMiningEventStatusLoaded(true);
  };

  const getFlagIcon = (countryCode) => {
    if (!countryCode || countryCode === 'Unknown') {
      return <span className="text-2xl drop-shadow-md">👤</span>;
    }
    const lowerCode = countryCode.toLowerCase();
    return (
      <img
        src={`https://flagcdn.com/w40/${lowerCode}.png`}
        alt={countryCode}
        className="w-7 h-5 object-cover rounded shadow-[0_0_5px_rgba(0,0,0,0.5)]"
      />
    );
  };

  const loadTop20 = async () => {
    setTop20Loading(true);
    setTop20Error('');
    try {
      const initData = window.Telegram?.WebApp?.initData;
      if (!initData) throw new Error('Please open APXN inside Telegram.');
      const response = await fetch('/api/top20', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ initData }),
        cache: 'no-store',
      });
      const data = await response.json();
      if (!response.ok || !data.success) throw new Error(data.error || 'Leaderboard unavailable');
      setTop20Users(Array.isArray(data.users) ? data.users : []);
      setTop20Month(data.month || '');
    } catch (error) {
      setTop20Error(error.message || 'Cannot load Top 20');
    } finally {
      setTop20Loading(false);
    }
  };

  const loadBscWallet = async () => {
    setBscWalletLoading(true);
    setBscWalletLoaded(false);
    setBscWalletMessage('');
    try {
      const initData = window.Telegram?.WebApp?.initData;
      if (!initData) throw new Error('Open APXN inside Telegram.');
      const response = await fetch('/api/profile-wallet', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ initData, action: 'load' }),
        cache: 'no-store',
      });
      const data = await response.json();
      if (!response.ok || !data.success) throw new Error(data.error || 'Wallet unavailable');
      setSavedBscWallet(data.address || '');
      setBscWalletInput(''); // Always show an empty field, even for old wallets.
      setWalletVerified(Boolean(data.verified));
      setBscWalletCanEdit(data.canEdit !== false);
      setBscWalletNextEditDate(data.nextEditDate || null);
      setBscWalletLoaded(true);
    } catch (error) {
      setBscWalletMessage(error.message || 'Wallet unavailable');
    } finally {
      setBscWalletLoading(false);
    }
  };

  const saveBscWallet = async (action) => {
    if (!bscWalletLoaded || bscWalletLoading) return;
    const isEdit = action === 'edit';
    if (isEdit ? !savedBscWallet : Boolean(savedBscWallet)) {
      setBscWalletMessage('Use the appropriate wallet button.');
      return;
    }
    if (isEdit && !bscWalletCanEdit) return;

    const address = bscWalletInput.trim();
    if (!/^0x[a-fA-F0-9]{40}$/.test(address) || /^0x0{40}$/i.test(address)) {
      setBscWalletMessage('Please enter a valid BSC address (0x + 40 hex characters).');
      return;
    }
    if (savedBscWallet && savedBscWallet.toLowerCase() === address.toLowerCase()) {
      setBscWalletMessage('This address is already saved.');
      return;
    }

    setBscWalletLoading(true);
    setBscWalletMessage('');
    try {
      const initData = window.Telegram?.WebApp?.initData;
      if (!initData) throw new Error('Open APXN inside Telegram.');
      const response = await fetch('/api/profile-wallet', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ initData, action, address }),
        cache: 'no-store',
      });
      const data = await response.json();
      if (!response.ok || !data.success) {
        if (data.code === 'WALLET_MONTHLY_LIMIT') {
          setBscWalletCanEdit(false);
          setBscWalletNextEditDate(data.nextEditDate || null);
        }
        throw new Error(data.error || 'Wallet save failed');
      }
      setSavedBscWallet(data.address || address);
      setBscWalletInput('');
      setWalletVerified(Boolean(data.verified));
      setBscWalletCanEdit(data.canEdit !== false);
      setBscWalletNextEditDate(data.nextEditDate || null);
      setBscWalletMessage(isEdit
        ? (data.verified ? 'Wallet updated and verified by APXN.' : 'Wallet updated.')
        : (data.verified ? 'BSC wallet saved and verified by APXN.' : 'BSC wallet saved.'));
    } catch (error) {
      setBscWalletMessage(error.message || 'Wallet save failed');
    } finally {
      setBscWalletLoading(false);
    }
  };

  const handleOpenProfile = async () => {
    setShowProfile(true);
    void loadBscWallet();

    // One lightweight badge check per app session only.
    // It does not touch mining, rewards, Stars, tasks or wallet state.
    if (
      profileBadgeChecked ||
      profileBadgeLoading ||
      !userId ||
      userId === 'test_user'
    ) {
      return;
    }

    setProfileBadgeLoading(true);

    try {
      const { data, error } = await supabase.rpc(
        'apex_has_early_access_badge',
        {
          p_telegram_id: String(userId),
        }
      );

      if (error) {
        console.error('APXN profile badge check failed');
        return;
      }

      setHasEarlyAccessBadge(Boolean(data));
      setProfileBadgeChecked(true);
    } catch {
      // Keep the profile usable if the badge check is temporarily unavailable.
    } finally {
      setProfileBadgeLoading(false);
    }
  };

  useEffect(() => {
    let attempts = 0;
    let timer = null;
    let cancelled = false;

    const applyCheckinState = (
      userData,
      authoritativeNowTime = null
    ) => {
      if (cancelled) return;

      const safeNowTime =
        Number.isFinite(
          Number(authoritativeNowTime)
        )
          ? Number(authoritativeNowTime)
          : Date.now();

      const todayStr =
        new Date(safeNowTime)
          .toISOString()
          .split('T')[0];

      const yesterday =
        new Date(safeNowTime);

      yesterday.setUTCDate(
        yesterday.getUTCDate() - 1
      );

      const yesterdayStr =
        yesterday
          .toISOString()
          .split('T')[0];

      const v2Enabled =
        Boolean(
          userData
            .dailyCheckinV2Enabled
        );

      let visibleStreak =
        Number(
          userData.checkinStreak || 0
        );

      const currentActiveDays =
        Number(
          userData.activeDays ??
          userData.checkinStreak ??
          0
        );

      const storedRecoveryDays =
        Math.max(
          0,
          Math.min(
            2,
            Number(
              userData.recoveryDays ?? 2
            )
          )
        );

      let visibleRecoveryDays =
        storedRecoveryDays;

      let rewardEligible =
        storedRecoveryDays >= 2;

      let rewardAmount = 100;
      let isCheckinAvailable = true;
      let lastDayStr = null;

      if (userData.lastCheckinDate) {
        const lastDate =
          new Date(
            userData.lastCheckinDate
          );

        if (
          Number.isFinite(
            lastDate.getTime()
          )
        ) {
          lastDayStr =
            lastDate
              .toISOString()
              .split('T')[0];
        }
      }

      if (lastDayStr === todayStr) {
        isCheckinAvailable = false;
      }

      if (v2Enabled) {
        if (!lastDayStr) {
          visibleRecoveryDays = 2;
          rewardEligible = true;
          rewardAmount = 100;
        } else if (
          lastDayStr === todayStr
        ) {
          visibleRecoveryDays =
            storedRecoveryDays;

          rewardEligible =
            storedRecoveryDays >= 2;

          rewardAmount =
            rewardEligible
              ? 100
              : 0;
        } else if (
          lastDayStr === yesterdayStr
        ) {
          visibleRecoveryDays =
            storedRecoveryDays;

          const recoveryAfterToday =
            Math.min(
              2,
              storedRecoveryDays + 1
            );

          rewardEligible =
            recoveryAfterToday >= 2;

          rewardAmount =
            rewardEligible
              ? 100
              : 0;
        } else {
          // A missed UTC day starts recovery.
          // The database still stores the previous
          // completed state until today's check-in.
          visibleRecoveryDays = 0;
          rewardEligible = false;
          rewardAmount = 0;
        }
      } else {
        if (
          lastDayStr &&
          lastDayStr !== todayStr &&
          lastDayStr !== yesterdayStr
        ) {
          visibleStreak = 0;
        }

        rewardEligible = true;
        rewardAmount =
          ((visibleStreak % 7) + 1) *
          100;
      }

      setCheckinStreak(
        visibleStreak
      );

      setActiveDays(
        Number.isFinite(
          currentActiveDays
        )
          ? currentActiveDays
          : 0
      );

      setCheckinRecoveryDays(
        visibleRecoveryDays
      );

      setCheckinRewardEligible(
        rewardEligible
      );

      setDailyCheckinV2Enabled(
        v2Enabled
      );

      setCanCheckIn(
        isCheckinAvailable
      );

      setDailyRewardAmt(
        rewardAmount
      );
    };

    const applyUserState = ({
      verifiedUserId,
      verifiedFirstName,
      verifiedUsername,
      userData,
      fromCache = false,
      eventData = null,
      authoritativeNowTime = null,
    }) => {
      if (cancelled) return;

      const currentDbRate = Number(userData.miningRate ?? 0.00025);
      const cachedActiveFriends = Number(userData.activeFriendsCount ?? 0);
      const cachedFriendsCount = Number(userData.friendsCount ?? 0);
      const currentMiningBoostStartedAt =
        userData.miningBoostStartedAt || null;

      const currentMiningBoostUntil =
        userData.miningBoostUntil || null;

      const currentStarsBoostStartedAt =
        userData.starsBoostStartedAt || null;

      const currentStarsBoostUntil =
        userData.starsBoostUntil || null;

      const eventActive =
        Boolean(eventData?.active);

      const currentEventBaseRate = Number(
        eventData?.baseRate || 0.02
      );

      const safeNowTime =
        Number.isFinite(
          Number(authoritativeNowTime)
        )
          ? Number(authoritativeNowTime)
          : Date.now();

      const currentMiningBoostRemaining =
        eventData
          ? getEventAwareMiningBoostRemaining({
              boostStartedAt:
                currentMiningBoostStartedAt,
              boostUntil:
                currentMiningBoostUntil,
              eventStartsAt:
                eventData.startsAt || null,
              eventEndsAt:
                eventData.endsAt || null,
              nowTime: safeNowTime,
            })
          : getRemainingMiningBoost(
              currentMiningBoostUntil
            );

      const currentStarsBoostRemaining =
        getRemainingStarsBoost(
          currentStarsBoostUntil,
          safeNowTime
        );

      const visibleBaseRate =
        eventActive
          ? currentEventBaseRate
          : currentDbRate;

      const cachedTotalRate =
        getEffectiveMiningRate(
          visibleBaseRate,
          cachedActiveFriends,
          !eventActive &&
            currentMiningBoostRemaining > 0
        );

      setUserId(verifiedUserId);
      setFirstName(verifiedFirstName);
      setUserName(verifiedUsername);

      setBalance(Number(userData.balance || 0));
      setMiningCountry(String(userData.country || '').toUpperCase());
      setDbMiningRate(currentDbRate);
      setTotalMiningRate(cachedTotalRate);

      setFriendsCount(cachedFriendsCount);
      setActiveFriendsCount(cachedActiveFriends);
      setFriendsLoaded(false);

      setTaskCompleted(Boolean(userData.channelJoined));
      setGroupTaskCompleted(Boolean(userData.groupJoined));
      setTwitterTaskCompleted(Boolean(userData.twitterJoined));

      const todayStr =
        new Date(safeNowTime)
          .toISOString()
          .split('T')[0];

      const twitterTaskCooldown =
        getRemainingDailyTaskCooldown(
          userData.lastTwitterTaskAt,
          safeNowTime
        );

      const telegramTaskCooldown =
        getRemainingDailyTaskCooldown(
          userData.lastTelegramTaskAt,
          safeNowTime
        );

      const legacyTwitterDone =
        !userData.lastTwitterTaskAt &&
        userData.lastTwitterTask === todayStr;

      const legacyTelegramDone =
        !userData.lastTelegramTaskAt &&
        userData.lastTelegramTask === todayStr;

      setDailyTwitterCooldown(
        twitterTaskCooldown
      );

      setDailyTelegramCooldown(
        telegramTaskCooldown
      );

      setDailyTwitterDone(
        twitterTaskCooldown > 0 ||
        legacyTwitterDone
      );

      setDailyTelegramDone(
        telegramTaskCooldown > 0 ||
        legacyTelegramDone
      );

      setAdRewardCooldown(
        getRemainingAdRewardCooldown(
          userData.lastAdRewardAt
        )
      );

      setIsAdRewardStatusLoaded(
        !fromCache
      );

      setMiningBoostStartedAt(
        currentMiningBoostStartedAt
      );

      setMiningBoostUntil(
        currentMiningBoostUntil
      );

      setMiningBoostRemaining(
        currentMiningBoostRemaining
      );

      setIsMiningBoostStatusLoaded(
        !fromCache
      );

      setStarsBoostStartedAt(
        currentStarsBoostStartedAt
      );

      setStarsBoostUntil(
        currentStarsBoostUntil
      );

      setStarsBoostRemaining(
        currentStarsBoostRemaining
      );

      applyCheckinState(
        userData,
        safeNowTime
      );

      const currentMiningSessionEndsAt =
        getMiningSessionEndsAt(
          userData.miningSessionEndsAt ||
            null,
          userData.lastClaim ||
            null
        );

      setMiningSessionEndsAt(
        currentMiningSessionEndsAt
      );

      setMiningSessionRemaining(
        Number.isFinite(
          currentMiningSessionEndsAt
        )
          ? Math.max(
              0,
              Math.ceil(
                (
                  currentMiningSessionEndsAt -
                  Date.now()
                ) / 1000
              )
            )
          : 0
      );

      if (userData.lastClaim) {
        const lastTime =
          new Date(
            userData.lastClaim
          ).getTime();

        const diffSeconds =
          Number.isFinite(lastTime)
            ? Math.max(
                0,
                (
                  Date.now() -
                  lastTime
                ) / 1000
              )
            : MINING_SESSION_DURATION_SECONDS;

        if (diffSeconds > 0) {
          setMiningDelta(
            calculateEstimatedMiningDelta({
              lastClaim:
                userData.lastClaim,
              miningSessionEndsAt:
                userData.miningSessionEndsAt ||
                null,
              baseRate:
                currentDbRate,
              activeFriends:
                cachedActiveFriends,
              boostStartedAt:
                currentMiningBoostStartedAt,
              boostUntil:
                currentMiningBoostUntil,
              eventStartsAt:
                eventData?.startsAt || null,
              eventEndsAt:
                eventData?.endsAt || null,
              eventBaseRate:
                currentEventBaseRate,
              starsBoostStartedAt:
                currentStarsBoostStartedAt,
              starsBoostUntil:
                currentStarsBoostUntil,
              starsBoostEvents: starsBoostEventsRef.current,
              nowTime: safeNowTime,
            })
          );
        } else {
          setMiningDelta(0);
        }

      } else {
        setMiningDelta(0);
      }

      setIsDataLoaded(true);

      if (!fromCache) {
        writeUserCache(verifiedUserId, {
          firstName: verifiedFirstName,
          username: verifiedUsername,
          balance: Number(userData.balance || 0),
          miningRate: currentDbRate,
          totalMiningRate: cachedTotalRate,
          friendsCount: cachedFriendsCount,
          activeFriendsCount: cachedActiveFriends,
          channelJoined: Boolean(userData.channelJoined),
          groupJoined: Boolean(userData.groupJoined),
          twitterJoined: Boolean(userData.twitterJoined),
          lastTwitterTask: userData.lastTwitterTask || null,
          lastTelegramTask: userData.lastTelegramTask || null,
          lastTwitterTaskAt: userData.lastTwitterTaskAt || null,
          lastTelegramTaskAt: userData.lastTelegramTaskAt || null,
          checkinStreak: Number(userData.checkinStreak || 0),
          activeDays:
            Number(
              userData.activeDays ??
              userData.checkinStreak ??
              0
            ),
          recoveryDays:
            Math.max(
              0,
              Math.min(
                2,
                Number(
                  userData.recoveryDays ?? 2
                )
              )
            ),
          dailyCheckinV2Enabled:
            Boolean(
              userData
                .dailyCheckinV2Enabled
            ),
          lastCheckinDate: userData.lastCheckinDate || null,
          lastClaim: userData.lastClaim || null,
          country: String(userData.country || '').toUpperCase(),
          miningSessionEndsAt:
            userData.miningSessionEndsAt ||
            null,
          lastAdRewardAt: userData.lastAdRewardAt || null,
          adRewardCount: Number(userData.adRewardCount || 0),
          miningBoostStartedAt:
            currentMiningBoostStartedAt,
          miningBoostUntil:
            currentMiningBoostUntil,
          miningBoostCount:
            Number(userData.miningBoostCount || 0),
          starsBoostStartedAt:
            currentStarsBoostStartedAt,
          starsBoostUntil:
            currentStarsBoostUntil,
          starsBoostCount:
            Number(userData.starsBoostCount || 0),
        });
      }
    };

    const startApp = async () => {
      if (typeof window === 'undefined') return;

      const telegram = window.Telegram?.WebApp;

      if (!telegram) {
        attempts += 1;

        if (attempts < 10) {
          timer = setTimeout(startApp, 500);
        } else if (!cancelled) {
          setUserId('test_user');
        }

        return;
      }

      telegram.ready();
      telegram.expand();

      const initData = telegram.initData;

      if (!initData) {
        if (!cancelled) {
          setUserId('test_user');
        }
        return;
      }

      try {
        // Bootstrap validates Telegram and returns the user and event.
        // Fall back to auth only if bootstrap is temporarily unavailable.
        let bootstrapData = null;
        let authData = null;

        try {
          const bootstrapResponse = await fetch('/api/bootstrap', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({ initData }),
            cache: 'no-store',
          });

          if (!bootstrapResponse.ok) {
            throw new Error('Bootstrap failed');
          }

          bootstrapData = await bootstrapResponse.json();

          if (
            !bootstrapData?.success ||
            !bootstrapData?.telegram?.id
          ) {
            throw new Error('Invalid bootstrap result');
          }

          authData = { user: bootstrapData.telegram };
        } catch {
          // Existing users may still use their authenticated local cache.
          const authResponse = await fetch('/api/auth/telegram', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({ initData }),
            cache: 'no-store',
          });

          if (!authResponse.ok) {
            throw new Error('Telegram authentication failed');
          }

          authData = await authResponse.json();
        }

        if (cancelled) return;

        // Keep both cached and newly registered users on the same
        // current links without an extra network request. If bootstrap
        // failed, keep the tasks hidden rather than show stale links.
        const runtimeTaskLinks = bootstrapData?.dailyTaskLinks;
        setDailyTwitterLink(
          typeof runtimeTaskLinks?.twitter === 'string'
            ? runtimeTaskLinks.twitter
            : ''
        );
        setDailyTelegramLink(
          typeof runtimeTaskLinks?.telegram === 'string'
            ? runtimeTaskLinks.telegram
            : ''
        );

        const verifiedUserId = String(authData.user.id);
        const verifiedFirstName =
          authData.user.firstName || 'Unknown';
        const verifiedUsername =
          authData.user.username || 'No Username';

        setUserId(verifiedUserId);
        setFirstName(verifiedFirstName);
        setUserName(verifiedUsername);

        // Existing users load instantly from local cache, then the
        // authoritative balance/event state is synchronized from Supabase.
        const cachedUser = readUserCache(verifiedUserId);

        if (cachedUser) {
          applyUserState({
            verifiedUserId,
            verifiedFirstName,
            verifiedUsername,
            userData: cachedUser,
            fromCache: true,
          });

          try {
            if (bootstrapData) {
              const data = bootstrapData;

              applyMiningEventState(
                data?.miningEvent || null
              );

              const eventData =
                data?.miningEvent || null;

              const authoritativeNowTime =
                eventData?.serverNow
                  ? new Date(
                      eventData.serverNow
                    ).getTime()
                  : Date.now();

              const freshBalance = Number(data?.user?.balance);

              if (
                !cancelled &&
                data?.exists &&
                data?.user
              ) {
                setMiningCountry(String(data.user.country || '').toUpperCase());

                if (Number.isFinite(freshBalance)) {
                  setBalance(freshBalance);
                }

                const freshLastAdRewardAt =
                  data.user.lastAdRewardAt || null;

                setAdRewardCooldown(
                  getRemainingAdRewardCooldown(
                    freshLastAdRewardAt
                  )
                );

                setIsAdRewardStatusLoaded(
                  true
                );

                const freshMiningBoostStartedAt =
                  data.user.miningBoostStartedAt || null;

                const freshMiningBoostUntil =
                  data.user.miningBoostUntil || null;

                const freshStarsBoostStartedAt =
                  data.user.starsBoostStartedAt || null;

                const freshStarsBoostUntil =
                  data.user.starsBoostUntil || null;

                const freshStarsBoostRemaining =
                  getRemainingStarsBoost(
                    freshStarsBoostUntil,
                    authoritativeNowTime
                  );

                const freshMiningBoostRemaining =
                  eventData
                    ? getEventAwareMiningBoostRemaining({
                        boostStartedAt:
                          freshMiningBoostStartedAt,
                        boostUntil:
                          freshMiningBoostUntil,
                        eventStartsAt:
                          eventData.startsAt || null,
                        eventEndsAt:
                          eventData.endsAt || null,
                        nowTime:
                          authoritativeNowTime,
                      })
                    : getRemainingMiningBoost(
                        freshMiningBoostUntil
                      );

                const freshMiningBoostCount =
                  Number(
                    data.user.miningBoostCount || 0
                  );

                const freshDbRate = Number(
                  data.user.miningRate ??
                  cachedUser.miningRate ??
                  0.00025
                );

                const cachedActiveFriends = Number(
                  cachedUser.activeFriendsCount || 0
                );

                const freshVisibleBaseRate =
                  eventData?.active
                    ? Number(
                        eventData.baseRate || 0.02
                      )
                    : freshDbRate;

                const freshTotalMiningRate =
                  getEffectiveMiningRate(
                    freshVisibleBaseRate,
                    cachedActiveFriends,
                    !eventData?.active &&
                      freshMiningBoostRemaining > 0
                  );

                const freshLastClaim =
                  data.user.lastClaim ||
                  cachedUser.lastClaim ||
                  null;

                const freshMiningSessionEndsAt =
                  data.user.miningSessionEndsAt ||
                  cachedUser.miningSessionEndsAt ||
                  null;

                const freshMiningSessionEndTime =
                  getMiningSessionEndsAt(
                    freshMiningSessionEndsAt,
                    freshLastClaim
                  );

                setMiningSessionEndsAt(
                  freshMiningSessionEndTime
                );

                setMiningSessionRemaining(
                  Number.isFinite(
                    freshMiningSessionEndTime
                  )
                    ? Math.max(
                        0,
                        Math.ceil(
                          (
                            freshMiningSessionEndTime -
                            Date.now()
                          ) / 1000
                        )
                      )
                    : 0
                );

                if (freshLastClaim) {
                  setMiningDelta(
                    calculateEstimatedMiningDelta({
                      lastClaim:
                        freshLastClaim,
                      miningSessionEndsAt:
                        freshMiningSessionEndsAt,
                      baseRate:
                        freshDbRate,
                      activeFriends:
                        cachedActiveFriends,
                      boostStartedAt:
                        freshMiningBoostStartedAt,
                      boostUntil:
                        freshMiningBoostUntil,
                      eventStartsAt:
                        eventData?.startsAt || null,
                      eventEndsAt:
                        eventData?.endsAt || null,
                      eventBaseRate:
                        Number(
                          eventData?.baseRate || 0.02
                        ),
                      starsBoostStartedAt:
                        freshStarsBoostStartedAt,
                      starsBoostUntil:
                        freshStarsBoostUntil,
                      starsBoostEvents: starsBoostEventsRef.current,
                      nowTime:
                        authoritativeNowTime,
                    })
                  );

                  const freshLastClaimTime =
                    new Date(
                      freshLastClaim
                    ).getTime();

                  if (
                    Number.isFinite(
                      freshLastClaimTime
                    )
                  ) {
                    const elapsedSeconds =
                      Math.max(
                        0,
                        (
                          Date.now() -
                          freshLastClaimTime
                        ) / 1000
                      );

                  }
                } else {
                  setMiningDelta(0);
                }

                setDbMiningRate(
                  freshDbRate
                );

                setTotalMiningRate(
                  freshTotalMiningRate
                );

                setMiningBoostStartedAt(
                  freshMiningBoostStartedAt
                );

                setMiningBoostUntil(
                  freshMiningBoostUntil
                );

                setMiningBoostRemaining(
                  freshMiningBoostRemaining
                );

                setIsMiningBoostStatusLoaded(
                  true
                );

                setStarsBoostStartedAt(
                  freshStarsBoostStartedAt
                );

                setStarsBoostUntil(
                  freshStarsBoostUntil
                );

                setStarsBoostRemaining(
                  freshStarsBoostRemaining
                );

                applyCheckinState(
                  data.user,
                  authoritativeNowTime
                );

                const freshTwitterTaskCooldown =
                  getRemainingDailyTaskCooldown(
                    data.user.lastTwitterTaskAt,
                    authoritativeNowTime
                  );

                const freshTelegramTaskCooldown =
                  getRemainingDailyTaskCooldown(
                    data.user.lastTelegramTaskAt,
                    authoritativeNowTime
                  );

                setDailyTwitterCooldown(
                  freshTwitterTaskCooldown
                );

                setDailyTelegramCooldown(
                  freshTelegramTaskCooldown
                );

                setDailyTwitterDone(
                  freshTwitterTaskCooldown > 0
                );

                setDailyTelegramDone(
                  freshTelegramTaskCooldown > 0
                );

                patchUserCache(verifiedUserId, {
                  ...(Number.isFinite(freshBalance)
                    ? { balance: freshBalance }
                    : {}),
                  miningRate:
                    freshDbRate,
                  totalMiningRate:
                    freshTotalMiningRate,
                  lastClaim:
                    freshLastClaim,
                  country: String(data.user.country || '').toUpperCase(),
                  miningSessionEndsAt:
                    freshMiningSessionEndsAt,
                  lastAdRewardAt:
                    freshLastAdRewardAt,
                  adRewardCount:
                    Number(
                      data.user.adRewardCount || 0
                    ),
                  miningBoostStartedAt:
                    freshMiningBoostStartedAt,
                  miningBoostUntil:
                    freshMiningBoostUntil,
                  miningBoostCount:
                    freshMiningBoostCount,
                  starsBoostStartedAt:
                    freshStarsBoostStartedAt,
                  starsBoostUntil:
                    freshStarsBoostUntil,
                  starsBoostCount:
                    Number(
                      data.user.starsBoostCount || 0
                    ),
                  checkinStreak:
                    Number(
                      data.user.checkinStreak || 0
                    ),
                  activeDays:
                    Number(
                      data.user.activeDays ??
                      data.user.checkinStreak ??
                      0
                    ),
                  recoveryDays:
                    Math.max(
                      0,
                      Math.min(
                        2,
                        Number(
                          data.user.recoveryDays ?? 2
                        )
                      )
                    ),
                  dailyCheckinV2Enabled:
                    Boolean(
                      data.user
                        .dailyCheckinV2Enabled
                    ),
                  lastCheckinDate:
                    data.user.lastCheckinDate ||
                    null,
                  lastTwitterTask:
                    data.user.lastTwitterTask ||
                    null,
                  lastTelegramTask:
                    data.user.lastTelegramTask ||
                    null,
                  lastTwitterTaskAt:
                    data.user.lastTwitterTaskAt ||
                    null,
                  lastTelegramTaskAt:
                    data.user.lastTelegramTaskAt ||
                    null,
                });
              }
            }
          } catch {
            // If synchronization temporarily fails, keep showing
            // the cached account and retry on the next app open.
          }

          return;
        }

        // Cache miss/new device: reuse the verified bootstrap response.
        if (!bootstrapData) {
          throw new Error('Bootstrap failed');
        }

        const data = bootstrapData;

        if (cancelled) return;

        applyMiningEventState(
          data?.miningEvent || null
        );

        const eventData =
          data?.miningEvent || null;

        const authoritativeNowTime =
          eventData?.serverNow
            ? new Date(
                eventData.serverNow
              ).getTime()
            : Date.now();

        if (data.exists && data.user) {
          applyUserState({
            verifiedUserId,
            verifiedFirstName,
            verifiedUsername,
            eventData,
            authoritativeNowTime,
            userData: {
              ...data.user,
              totalMiningRate: Number(data.user.miningRate || 0.00025),
              friendsCount: 0,
              activeFriendsCount: 0,
            },
          });
          return;
        }

        // New user registration is handled securely on the server.
        const registerResponse = await fetch('/api/register', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ initData }),
          cache: 'no-store',
        });

        if (!registerResponse.ok) {
          throw new Error('Registration failed');
        }

        const registerData = await registerResponse.json();

        if (cancelled) return;

        if (!registerData.success || !registerData.user) {
          throw new Error('Invalid registration result');
        }

        const registeredUser = registerData.user;

        applyUserState({
          verifiedUserId,
          verifiedFirstName,
          verifiedUsername,
          eventData,
          authoritativeNowTime,
          userData: {
            balance: Number(registeredUser.balance || 0),
            miningRate: Number(
              registeredUser.miningRate || 0.00025
            ),
            totalMiningRate: Number(
              registeredUser.miningRate || 0.00025
            ),
            country: registeredUser.country || '',
            friendsCount: 0,
            activeFriendsCount: 0,
            channelJoined: false,
            groupJoined: false,
            twitterJoined: false,
            lastTwitterTask: null,
            lastTelegramTask: null,
            lastTwitterTaskAt: null,
            lastTelegramTaskAt: null,
            checkinStreak: 0,
            activeDays: 0,
            recoveryDays: 2,
            dailyCheckinV2Enabled: false,
            lastCheckinDate: null,
            lastClaim:
              registeredUser.lastClaim ||
              new Date().toISOString(),
            miningSessionEndsAt:
              registeredUser
                .miningSessionEndsAt ||
              null,
            lastAdRewardAt: null,
            adRewardCount: 0,
            miningBoostStartedAt: null,
            miningBoostUntil: null,
            miningBoostCount: 0,
            starsBoostStartedAt: null,
            starsBoostUntil: null,
            starsBoostCount: 0,
          },
        });

        if (registerData.created) {
          // Use only rewards confirmed by Supabase.
          //
          // Never infer referral eligibility from
          // Telegram start_param on the frontend.
          setWelcomeAmount(
            Number(registerData.welcomeBonus || 0)
          );

          setReferralBonusAmount(
            Number(registerData.referralBonus || 0)
          );

          setShowWelcome(true);
        }

      } catch (error) {
        console.error('App start failed');

        if (!cancelled) {
          setUserId('test_user');
        }
      }
    };

    startApp();

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, []);

  // Fetch the precise 5k/10k paid intervals independently of app startup.
  // Any temporary failure here must never block mining, wallet or Staking.
  useEffect(() => {
    if (!isDataLoaded || !userId || userId === 'test_user') return;
    let cancelled = false;
    setStarsBoostStatusLoaded(false);
    starsBoostEventsRef.current = [];
    setStarsBoostEvents([]);
    fetchStarsBoostEvents()
      .then((events) => {
        if (cancelled) return;
        starsBoostEventsRef.current = events;
        setStarsBoostEvents(events);
        setStarsBoostStatusLoaded(true);
      })
      .catch(() => {
        if (cancelled) return;
        // If the status request fails, do not invent a paid reward rate.
        setStarsBoostStatusLoaded(false);
      });
    return () => { cancelled = true; };
  }, [isDataLoaded, userId]);

  // Reconcile the visible pending balance after authoritative paid events
  // arrive. Base mining and ad/referral calculations remain unchanged.
  useEffect(() => {
    if (!isDataLoaded || !userId || !starsBoostStatusLoaded) return;
    const cached = readUserCache(userId);
    if (!cached?.lastClaim) return;
    setMiningDelta(calculateEstimatedMiningDelta({
      lastClaim: cached.lastClaim,
      miningSessionEndsAt: cached.miningSessionEndsAt || null,
      baseRate: Number(cached.miningRate ?? 0.00025),
      activeFriends: Number(cached.activeFriendsCount || 0),
      boostStartedAt: cached.miningBoostStartedAt || null,
      boostUntil: cached.miningBoostUntil || null,
      eventStartsAt: miningEventStartsAt,
      eventEndsAt: miningEventEndsAt,
      eventBaseRate: miningEventBaseRate,
      starsBoostEvents,
      nowTime: Date.now(),
    }));
  }, [isDataLoaded, userId, starsBoostStatusLoaded, starsBoostEvents]);

  const refreshMiningEventState = async () => {
    const initData =
      typeof window !== 'undefined'
        ? window.Telegram?.WebApp?.initData
        : null;

    if (!initData) return;

    try {
      const response = await fetch('/api/bootstrap', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ initData }),
        cache: 'no-store',
      });

      if (!response.ok) return;

      const data = await response.json();
      const eventData = data?.miningEvent || null;

      if (!eventData) return;

      applyMiningEventState(eventData);

      if (data?.exists && data?.user) {
        const freshDbRate = Number(
          data.user.miningRate ?? dbMiningRate
        );

        const freshBoostStartedAt =
          data.user.miningBoostStartedAt || null;

        const freshBoostUntil =
          data.user.miningBoostUntil || null;

        const freshStarsBoostStartedAt =
          data.user.starsBoostStartedAt || null;

        const freshStarsBoostUntil =
          data.user.starsBoostUntil || null;

        const authoritativeNowTime =
          eventData.serverNow
            ? new Date(
                eventData.serverNow
              ).getTime()
            : Date.now();

        const freshStarsBoostRemaining =
          getRemainingStarsBoost(
            freshStarsBoostUntil,
            authoritativeNowTime
          );

        const freshBoostRemaining =
          getEventAwareMiningBoostRemaining({
            boostStartedAt:
              freshBoostStartedAt,
            boostUntil:
              freshBoostUntil,
            eventStartsAt:
              eventData.startsAt || null,
            eventEndsAt:
              eventData.endsAt || null,
            nowTime:
              authoritativeNowTime,
          });

        const freshLastClaim =
          data.user.lastClaim || null;

        const freshMiningSessionEndsAt =
          data.user.miningSessionEndsAt ||
          null;

        const freshMiningSessionEndTime =
          getMiningSessionEndsAt(
            freshMiningSessionEndsAt,
            freshLastClaim
          );

        setMiningSessionEndsAt(
          freshMiningSessionEndTime
        );

        setMiningSessionRemaining(
          Number.isFinite(
            freshMiningSessionEndTime
          )
            ? Math.max(
                0,
                Math.ceil(
                  (
                    freshMiningSessionEndTime -
                    Date.now()
                  ) / 1000
                )
              )
            : 0
        );

        if (userId) {
          patchUserCache(userId, {
            lastClaim:
              freshLastClaim,
            miningSessionEndsAt:
              freshMiningSessionEndsAt,
          });
        }

        setDbMiningRate(freshDbRate);
        setMiningBoostStartedAt(
          freshBoostStartedAt
        );
        setMiningBoostUntil(
          freshBoostUntil
        );
        setMiningBoostRemaining(
          freshBoostRemaining
        );
        setIsMiningBoostStatusLoaded(true);

        setStarsBoostStartedAt(
          freshStarsBoostStartedAt
        );

        setStarsBoostUntil(
          freshStarsBoostUntil
        );

        setStarsBoostRemaining(
          freshStarsBoostRemaining
        );

        if (userId) {
          patchUserCache(userId, {
            starsBoostStartedAt:
              freshStarsBoostStartedAt,
            starsBoostUntil:
              freshStarsBoostUntil,
            starsBoostCount:
              Number(
                data.user.starsBoostCount || 0
              ),
          });
        }
      }
    } catch {
      // The previously confirmed server state remains in place.
    }
  };

  // Server-authoritative APXN event clock.
  // The phone's wall clock is never used to decide event start/end.
  useEffect(() => {
    if (!miningEventStatusLoaded) return;

    const interval = setInterval(() => {
      setMiningEventClockElapsed(
        prev => prev + 1
      );

      if (miningEventPhase === 'before') {
        setMiningEventStartsIn(
          prev => Math.max(0, prev - 1)
        );
      }

      if (miningEventPhase === 'active') {
        setMiningEventRemaining(
          prev => Math.max(0, prev - 1)
        );
      }
    }, 1000);

    return () => clearInterval(interval);
  }, [
    miningEventStatusLoaded,
    miningEventPhase,
  ]);

  // Re-confirm the event with the server at the exact server-provided
  // boundary. This prevents a local phone-clock change from activating
  // or extending the event.
  useEffect(() => {
    if (!miningEventStatusLoaded) return;

    let boundarySeconds = 0;

    if (miningEventPhase === 'before') {
      boundarySeconds = Math.max(
        0,
        Number(miningEventStartsIn || 0)
      );
    } else if (miningEventPhase === 'active') {
      boundarySeconds = Math.max(
        0,
        Number(miningEventRemaining || 0)
      );
    } else {
      return;
    }

    const timeout = setTimeout(
      () => {
        refreshMiningEventState();
      },
      Math.max(
        250,
        boundarySeconds * 1000 + 250
      )
    );

    return () => clearTimeout(timeout);
    // Intentionally scheduled once per confirmed server phase.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    miningEventStatusLoaded,
    miningEventPhase,
    miningEventStartsAt,
    miningEventEndsAt,
  ]);

  // Mobile browsers can suspend timers in the background.
  // Refresh from Supabase when Telegram becomes visible again.
  useEffect(() => {
    if (typeof document === 'undefined') return;

    const handleVisibility = () => {
      if (
        document.visibilityState === 'visible' &&
        miningEventStatusLoaded
      ) {
        refreshMiningEventState();
      }
    };

    document.addEventListener(
      'visibilitychange',
      handleVisibility
    );

    return () => {
      document.removeEventListener(
        'visibilitychange',
        handleVisibility
      );
    };
  }, [miningEventStatusLoaded]);

  // Recalculate saved x3 time whenever the authoritative event phase
  // changes or a fresh boost timestamp is received from the server.
  useEffect(() => {
    if (!miningEventStatusLoaded) return;

    setMiningBoostRemaining(
      getEventAwareMiningBoostRemaining({
        boostStartedAt:
          miningBoostStartedAt,
        boostUntil:
          miningBoostUntil,
        eventStartsAt:
          miningEventStartsAt,
        eventEndsAt:
          miningEventEndsAt,
        nowTime:
          getAuthoritativeNowTime(),
      })
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    miningEventStatusLoaded,
    miningEventPhase,
    miningEventServerNowMs,
    miningBoostStartedAt,
    miningBoostUntil,
    miningEventStartsAt,
    miningEventEndsAt,
  ]);

  // Keep referral mining speed accurate as soon as the app opens.
  //
  // We request only one friend row here because the purpose of this
  // lightweight call is to refresh total/active referral counts.
  // The full referral list is still loaded only when the Friends tab
  // is opened, so startup remains fast.
  useEffect(() => {
    const loadReferralSummary = async () => {
      if (
        !isDataLoaded ||
        !userId ||
        userId === 'test_user' ||
        referralSummaryLoaded
      ) {
        return;
      }

      const initData =
        typeof window !== 'undefined'
          ? window.Telegram?.WebApp?.initData
          : null;

      if (!initData) {
        setReferralSummaryLoaded(true);
        return;
      }

      try {
        const response = await fetch('/api/friends', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            initData,
            limit: 1,
            offset: 0,
          }),
          cache: 'no-store',
        });

        const data = await response.json();

        if (!response.ok) {
          throw new Error(
            data.error || 'Referral summary load failed'
          );
        }

        const totalFriends = Number(
          data.totalFriends || 0
        );

        const activeCount = Number(
          data.activeFriends || 0
        );

        const finalRate =
          getEffectiveMiningRate(
            effectiveBaseMiningRate,
            activeCount,
            isMiningBoostActive
          );

        setFriendsCount(totalFriends);
        setActiveFriendsCount(activeCount);
        setTotalMiningRate(finalRate);

        // Recalculate the visible pending mining amount using
        // the refreshed active-referral count. The authoritative
        // Claim RPC in Supabase remains the final source of truth.
        const cachedUser = readUserCache(userId);
        const cachedLastClaim =
          cachedUser?.lastClaim || null;

        if (cachedLastClaim) {
          setMiningDelta(
            calculateEstimatedMiningDelta({
              lastClaim:
                cachedLastClaim,
              miningSessionEndsAt:
                cachedUser?.miningSessionEndsAt ||
                null,
              baseRate: dbMiningRate,
              activeFriends: activeCount,
              boostStartedAt:
                miningBoostStartedAt ||
                cachedUser?.miningBoostStartedAt ||
                null,
              boostUntil:
                miningBoostUntil ||
                cachedUser?.miningBoostUntil ||
                null,
              eventStartsAt:
                miningEventStartsAt,
              eventEndsAt:
                miningEventEndsAt,
              eventBaseRate:
                miningEventBaseRate,
              starsBoostStartedAt:
                starsBoostStartedAt ||
                cachedUser?.starsBoostStartedAt ||
                null,
              starsBoostUntil:
                starsBoostUntil ||
                cachedUser?.starsBoostUntil ||
                null,
              starsBoostEvents,
              nowTime:
                getAuthoritativeNowTime(),
            })
          );
        }

        patchUserCache(userId, {
          friendsCount: totalFriends,
          activeFriendsCount: activeCount,
          totalMiningRate: finalRate,
        });
      } catch (error) {
        console.error('Referral summary load failed');
      } finally {
        setReferralSummaryLoaded(true);
      }
    };

    loadReferralSummary();
  }, [
    isDataLoaded,
    userId,
    referralSummaryLoaded,
    dbMiningRate,
    effectiveBaseMiningRate,
    isMiningBoostActive,
    miningBoostStartedAt,
    miningBoostUntil,
    miningEventStartsAt,
    miningEventEndsAt,
    miningEventBaseRate,
    starsBoostStartedAt,
    starsBoostUntil,
    starsBoostEvents,
  ]);

  // Friends are fetched only when the Friends tab is actually opened.
  // The browser calls our protected API instead of reading public.users directly.
  useEffect(() => {
    const loadFriends = async () => {
      if (
        activeTab !== 'friends' ||
        !isDataLoaded ||
        !userId ||
        userId === 'test_user' ||
        friendsLoaded
      ) {
        return;
      }

      const initData =
        typeof window !== 'undefined'
          ? window.Telegram?.WebApp?.initData
        : null;

      if (!initData) {
        setFriendsLoaded(true);
        return;
      }

      try {
        const response = await fetch('/api/friends', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            initData,
            limit: 50,
            offset: 0,
          }),
          cache: 'no-store',
        });

        const data = await response.json();

        if (!response.ok) {
          throw new Error(data.error || 'Friends load failed');
        }

        const safeFriends = Array.isArray(data.friends)
          ? data.friends
          : [];
        const totalFriends = Number(data.totalFriends || 0);
        const activeCount = Number(data.activeFriends || 0);
        const finalRate =
          getEffectiveMiningRate(
            effectiveBaseMiningRate,
            activeCount,
            isMiningBoostActive
          );

        setFriendsList(safeFriends);
        setFriendsCount(totalFriends);
        setActiveFriendsCount(activeCount);
        setTotalMiningRate(finalRate);
        setFriendsLoaded(true);
        setReferralSummaryLoaded(true);

        patchUserCache(userId, {
          friendsCount: totalFriends,
          activeFriendsCount: activeCount,
          totalMiningRate: finalRate,
        });
      } catch (error) {
        console.error('Friends load failed');
        setFriendsLoaded(true);
      }
    };

    loadFriends();
  }, [
    activeTab,
    isDataLoaded,
    userId,
    friendsLoaded,
    effectiveBaseMiningRate,
    isMiningBoostActive,
  ]);

  useEffect(() => {
    const interval = setInterval(() => {
      const remaining =
        Number.isFinite(miningSessionEndsAt)
          ? Math.max(
              0,
              Math.ceil(
                (
                  miningSessionEndsAt -
                  Date.now()
                ) / 1000
              )
            )
          : 0;

      setMiningSessionRemaining(
        remaining
      );

      if (remaining > 0) {
        setMiningDelta(prev =>
          prev + totalMiningRate
        );
      }

      setAdRewardCooldown(prev => (prev > 0 ? prev - 1 : 0));

      setDailyTwitterCooldown(prev => {
        if (prev <= 1) {
          if (prev > 0) {
            setDailyTwitterDone(false);
          }
          return 0;
        }
        return prev - 1;
      });

      setDailyTelegramCooldown(prev => {
        if (prev <= 1) {
          if (prev > 0) {
            setDailyTelegramDone(false);
          }
          return 0;
        }
        return prev - 1;
      });

      // x3 time is frozen during the APXN 48-hour event.
      if (!isMiningEventActive) {
        setMiningBoostRemaining(
          prev => (prev > 0 ? prev - 1 : 0)
        );
      }
    }, 1000);

    return () => clearInterval(interval);
  }, [
    totalMiningRate,
    miningSessionEndsAt,
    isMiningEventActive,
  ]);

  useEffect(() => {
    if (
      !isDataLoaded ||
      !starsBoostUntil
    ) {
      return;
    }

    const interval = setInterval(() => {
      setStarsBoostRemaining(prev => {
        if (prev <= 0) {
          return 0;
        }

        // Only show a paid rate confirmed by its actual 5k/10k event.
        if (starsBoostStatusLoaded) {
          setMiningDelta(delta =>
            delta + getActiveStarsBoostRate(starsBoostEvents)
          );
        }

        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(interval);
  }, [
    isDataLoaded,
    starsBoostUntil,
    starsBoostEvents,
    starsBoostStatusLoaded,
  ]);

  useEffect(() => {
    setTotalMiningRate(
      getEffectiveMiningRate(
        effectiveBaseMiningRate,
        activeFriendsCount,
        isMiningBoostActive
      )
    );
  }, [
    effectiveBaseMiningRate,
    activeFriendsCount,
    isMiningBoostActive,
  ]);

  const handleBuyStarsBoost = async () => {
    if (
      !isDataLoaded ||
      isBuyingStarsBoost ||
      isStarsBoostActive
    ) {
      return;
    }

    const telegram =
      typeof window !== 'undefined'
        ? window.Telegram?.WebApp
        : null;

    const initData =
      telegram?.initData || null;

    if (
      !telegram ||
      !initData ||
      typeof telegram.openInvoice !== 'function'
    ) {
      alert(
        '❌ Please open Apex Network inside Telegram to use Telegram Stars.'
      );
      return;
    }

    setIsBuyingStarsBoost(true);

    try {
      const response = await fetch(
        '/api/stars/boost/invoice',
        {
          method: 'POST',
          headers: {
            'Content-Type':
              'application/json',
          },
          body: JSON.stringify({
            initData,
          }),
          cache: 'no-store',
        }
      );

      const data = await response.json();

      if (!response.ok) {
        if (
          response.status === 409 &&
          data?.active
        ) {
          setIsBuyingStarsBoost(false);
          await refreshMiningEventState();
          setShowStarsBoostModal(true);
          return;
        }

        throw new Error(
          data?.error ||
            'Could not create Telegram Stars invoice'
        );
      }

      const invoiceLink =
        data?.invoiceLink;

      if (!invoiceLink) {
        throw new Error(
          'Telegram invoice link is missing'
        );
      }

      telegram.openInvoice(
        invoiceLink,
        async status => {
          setIsBuyingStarsBoost(false);

          if (status === 'paid') {
            setShowStarsBoostModal(false);

            // Telegram confirms payment to the bot webhook.
            // Refresh server-authoritative boost state after
            // giving the webhook a short moment to activate it.
            for (
              let attempt = 0;
              attempt < 4;
              attempt += 1
            ) {
              await new Promise(resolve =>
                window.setTimeout(
                  resolve,
                  900
                )
              );

              await refreshMiningEventState();
            }

            try {
              const events = await fetchStarsBoostEvents();
              starsBoostEventsRef.current = events;
              setStarsBoostEvents(events);
              setStarsBoostStatusLoaded(true);
            } catch {
              // The paid boost is recorded by the Telegram webhook;
              // its rate will sync when the app is reopened.
              setStarsBoostStatusLoaded(false);
            }

            alert(
              '✅ Telegram Stars payment received!\n\n⛏️ 5,000 APXN POINTS\n⭐ 10 Telegram Stars\n⏱ 48 hours'
            );
            return;
          }

          if (status === 'failed') {
            alert(
              '❌ Telegram Stars payment failed. Please try again.'
            );
          }
        }
      );
    } catch (error) {
      console.error(
        'Stars boost purchase failed:',
        error
      );

      setIsBuyingStarsBoost(false);

      alert(
        '❌ Could not start the Telegram Stars payment. Please try again.'
      );
    }
  };

  const handleDailyCheckIn = async () => {
    if (!isDataLoaded || !canCheckIn || isSaving) return;

    const initData =
      typeof window !== 'undefined'
        ? window.Telegram?.WebApp?.initData
        : null;

    if (!initData) {
      alert('❌ Please open Apex Miner inside Telegram.');
      return;
    }

    setIsSaving(true);

    try {
      const response = await fetch('/api/checkin', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          initData,
          clientV2:
            dailyCheckinV2Enabled,
        }),
        cache: 'no-store',
      });

      const data = await response.json();

      if (!response.ok) {
        if (response.status === 409) {
          const syncedBalance =
            Number(data.balance);

          const syncedStreak =
            Number(data.checkinStreak);

          const syncedActiveDays =
            Number(data.activeDays);

          const syncedRecoveryDays =
            Number(data.recoveryDays);

          const syncedRewardEligible =
            Boolean(
              data.rewardEligible
            );

          const syncedLastCheckinDate =
            data.lastCheckinDate ||
            new Date().toISOString();

          if (
            Number.isFinite(
              syncedBalance
            )
          ) {
            setBalance(
              syncedBalance
            );
          }

          if (
            Number.isFinite(
              syncedStreak
            )
          ) {
            setCheckinStreak(
              syncedStreak
            );
          }

          if (
            Number.isFinite(
              syncedActiveDays
            )
          ) {
            setActiveDays(
              syncedActiveDays
            );
          }

          if (
            Number.isFinite(
              syncedRecoveryDays
            )
          ) {
            setCheckinRecoveryDays(
              Math.max(
                0,
                Math.min(
                  2,
                  syncedRecoveryDays
                )
              )
            );
          }

          if (
            dailyCheckinV2Enabled
          ) {
            setCheckinRewardEligible(
              syncedRewardEligible
            );

            setDailyRewardAmt(
              syncedRewardEligible
                ? 100
                : 0
            );
          } else if (
            Number.isFinite(
              syncedStreak
            )
          ) {
            setDailyRewardAmt(
              ((syncedStreak % 7) + 1) *
              100
            );
          }

          setCanCheckIn(false);

          patchUserCache(userId, {
            ...(Number.isFinite(syncedBalance)
              ? { balance: syncedBalance }
              : {}),
            ...(Number.isFinite(syncedStreak)
              ? { checkinStreak: syncedStreak }
              : {}),
            ...(Number.isFinite(syncedActiveDays)
              ? { activeDays: syncedActiveDays }
              : {}),
            ...(Number.isFinite(syncedRecoveryDays)
              ? {
                  recoveryDays:
                    Math.max(
                      0,
                      Math.min(
                        2,
                        syncedRecoveryDays
                      )
                    ),
                }
              : {}),
            dailyCheckinV2Enabled,
            lastCheckinDate:
              syncedLastCheckinDate,
          });

          return;
        }

        throw new Error(data.error || 'Check-in failed');
      }

      const newBalance =
        Number(data.balance || 0);

      const newStreak =
        Number(data.checkinStreak || 0);

      const newActiveDays =
        Number(data.activeDays);

      const newRecoveryDays =
        Number(data.recoveryDays);

      const newRewardEligible =
        Boolean(
          data.rewardEligible
        );

      const lastCheckinDate =
        data.lastCheckinDate ||
        new Date().toISOString();

      setBalance(newBalance);
      setCheckinStreak(newStreak);

      if (
        Number.isFinite(
          newActiveDays
        )
      ) {
        setActiveDays(
          newActiveDays
        );
      }

      if (
        Number.isFinite(
          newRecoveryDays
        )
      ) {
        setCheckinRecoveryDays(
          Math.max(
            0,
            Math.min(
              2,
              newRecoveryDays
            )
          )
        );
      }

      setCanCheckIn(false);

      if (dailyCheckinV2Enabled) {
        setCheckinRewardEligible(
          newRewardEligible
        );

        setDailyRewardAmt(
          newRewardEligible
            ? 100
            : 0
        );
      } else {
        setDailyRewardAmt(
          ((newStreak % 7) + 1) *
          100
        );
      }

      patchUserCache(userId, {
        balance: newBalance,
        checkinStreak: newStreak,
        ...(Number.isFinite(newActiveDays)
          ? { activeDays: newActiveDays }
          : {}),
        ...(Number.isFinite(newRecoveryDays)
          ? {
              recoveryDays:
                Math.max(
                  0,
                  Math.min(
                    2,
                    newRecoveryDays
                  )
                ),
            }
          : {}),
        dailyCheckinV2Enabled,
        lastCheckinDate,
      });
    } catch (error) {
      console.error('Check-in failed:', error);
      alert('❌ Check-in failed. Please try again.');
    } finally {
      setIsSaving(false);
    }
  };

  const handleClaim = async () => {
    // Claim pending points only when a 24-hour session is restarted.
    if (
      !isDataLoaded ||
      !isMiningPaused ||
      isSaving ||
      isWatchingRestartAd ||
      isWatchingAd ||
      isWatchingBoostAd
    ) {
      return;
    }

    const requiresRestartAd = true;
    const initData =
      typeof window !== 'undefined'
        ? window.Telegram?.WebApp?.initData
        : null;

    if (!initData) {
      alert('❌ Please open Apex Miner inside Telegram.');
      return;
    }

    
    const restartAdCompleted = false;
    const restartMode = 'ad_unavailable';

    try {


      setIsSaving(true);

      const response = await fetch('/api/mining/restart', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ initData, restartMode }),
        cache: 'no-store',
      });

      const data =
        await response.json();

      if (!response.ok) {
        if (
          data.errorCode ===
          'SESSION_EXPIRED'
        ) {
          setMiningSessionRemaining(
            0
          );
        }

        if (
          requiresRestartAd &&
          data.errorCode ===
            'SESSION_ACTIVE' &&
          data.retryAfter
        ) {
          const retryAfter =
            Math.max(
              1,
              Number(
                data.retryAfter
              )
            );

          setMiningSessionRemaining(
            retryAfter
          );

          setMiningSessionEndsAt(
            Date.now() +
              retryAfter * 1000
          );
        }

        throw new Error(
          data.error ||
          (
            requiresRestartAd
              ? 'Mining restart failed'
              : 'Claim failed'
          )
        );
      }

      const newLastClaim =
        data.lastClaim ||
        new Date().toISOString();

      const newBalance =
        Number(
          data.balance || 0
        );

      const returnedBaseMiningRate =
        Number(
          data.baseMiningRate
        );

      const returnedTotalMiningRate =
        Number(
          data.miningRate
        );

      setBalance(
        newBalance
      );

      setMiningDelta(0);

      const returnedMiningSessionEndsAt =
        data.miningSessionEndsAt ||
        null;

      if (requiresRestartAd) {
        const newSessionEndTime =
          getMiningSessionEndsAt(
            returnedMiningSessionEndsAt,
            newLastClaim
          );

        setMiningSessionEndsAt(
          newSessionEndTime
        );

        setMiningSessionRemaining(
          Number.isFinite(
            newSessionEndTime
          )
            ? Math.max(
                0,
                Math.ceil(
                  (
                    newSessionEndTime -
                    Date.now()
                  ) / 1000
                )
              )
            : MINING_SESSION_DURATION_SECONDS
        );
      }

      // During the event the RPC returns the temporary
      // 0.02 rate. Never overwrite the user's permanent
      // stored base rate with it.
      if (
        !isMiningEventActive &&
        Number.isFinite(
          returnedBaseMiningRate
        )
      ) {
        setDbMiningRate(
          returnedBaseMiningRate
        );
      }

      if (
        Number.isFinite(
          returnedTotalMiningRate
        )
      ) {
        setTotalMiningRate(
          returnedTotalMiningRate
        );
      }

      if (
        Number.isFinite(
          Number(
            data.activeFriends
          )
        )
      ) {
        setActiveFriendsCount(
          Number(
            data.activeFriends
          )
        );
      }

      const cacheBaseRate =
        !isMiningEventActive &&
        Number.isFinite(
          returnedBaseMiningRate
        )
          ? returnedBaseMiningRate
          : dbMiningRate;

      patchUserCache(
        userId,
        {
          balance:
            newBalance,
          miningRate:
            cacheBaseRate,
          totalMiningRate:
            Number.isFinite(
              returnedTotalMiningRate
            )
              ? returnedTotalMiningRate
              : totalMiningRate,
          activeFriendsCount:
            Number(
              data.activeFriends || 0
            ),
          lastClaim:
            newLastClaim,
          ...(
            requiresRestartAd
              ? {
                  miningSessionEndsAt:
                    returnedMiningSessionEndsAt,
                }
              : {}
          ),
        }
      );
    } catch (error) {
      console.error(
        requiresRestartAd
          ? 'Mining restart failed:'
          : 'Claim failed:',
        error
      );

      if (
        requiresRestartAd &&
        error?.message === 'MINING_RESTART_AD_TIMEOUT'
      ) {
        // Refresh only after a real hang to dismiss the third-party ad
        // overlay. Do not call the mining API or credit any points.
        window.location.reload();
        return;
      }

      if (
        requiresRestartAd &&
        !restartAdCompleted &&
        restartMode !== 'ad_unavailable'
      ) {
        alert(
          '❌ Restart ad was not completed. Mining was not restarted.'
        );
      } else if (
        error?.message &&
        error.message !==
          'Claim cooldown active'
      ) {
        alert(
          requiresRestartAd
            ? '❌ Mining restart failed. Please try again.'
            : '❌ Claim failed. Please try again.'
        );
      }
    } finally {
      setIsSaving(false);
      setIsWatchingRestartAd(
        false
      );
    }
  };

  const updateTaskConfirmStage = (key, stage) => {
    setTaskConfirmStages(prev => ({
      ...prev,
      [key]: stage,
    }));
  };

  const getTaskConfirmLabel = ({
    key,
    completed,
    loading = false,
  }) => {
    if (completed) return 'Done ✓';
    if (loading) return 'Wait..';

    const stage = Number(
      taskConfirmStages[key] || 0
    );

    if (stage === 0) return 'GO';
    if (stage === 1) return 'CONFIRM';
    return 'CONFIRM AGAIN';
  };

  const runTaskConfirmationFlow = async ({
    key,
    link,
    completed,
    busy,
    onFinalConfirm,
  }) => {
    if (
      !isDataLoaded ||
      completed ||
      busy ||
      !link
    ) {
      return;
    }

    const stage = Number(
      taskConfirmStages[key] || 0
    );

    // First press: open the real Telegram/X destination.
    if (stage === 0) {
      window.open(link, '_blank');
      updateTaskConfirmStage(key, 1);
      return;
    }

    // First confirmation: ask the user to confirm once more.
    // No reward request is sent yet.
    if (stage === 1) {
      updateTaskConfirmStage(key, 2);

      alert(
        '⚠️ Please complete the task, then confirm it one more time.'
      );
      return;
    }

    // Second confirmation: only now call the existing protected API.
    await onFinalConfirm();
  };

  const claimDailyTask = async ({
    task,
    completed,
    verifying,
    setCompleted,
    setVerifying,
    setCooldown,
    cacheField,
    timestampCacheField,
    confirmationKey,
  }) => {
    if (
      !isDataLoaded ||
      completed ||
      verifying
    ) {
      return;
    }

    const initData =
      typeof window !== 'undefined'
        ? window.Telegram?.WebApp?.initData
        : null;

    if (!initData) {
      alert('❌ Please open Apex Miner inside Telegram.');
      return;
    }

    setVerifying(true);

    try {
      const response = await fetch('/api/tasks/daily', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          initData,
          task,
        }),
        cache: 'no-store',
      });

      const data = await response.json();

      if (!response.ok) {
        if (
          response.status === 409 &&
          data.completed
        ) {
          const syncedBalance = Number(
            data.balance
          );

          if (Number.isFinite(syncedBalance)) {
            setBalance(syncedBalance);
          }

          const taskDate =
            data.lastTaskDate ||
            new Date().toISOString().split('T')[0];

          const taskTimestamp =
            new Date().toISOString();

          setCompleted(true);
          setCooldown(
            DAILY_TASK_COOLDOWN_SECONDS
          );

          updateTaskConfirmStage(
            confirmationKey,
            0
          );

          patchUserCache(userId, {
            ...(Number.isFinite(syncedBalance)
              ? { balance: syncedBalance }
              : {}),
            [cacheField]: taskDate,
            [timestampCacheField]:
              taskTimestamp,
          });

          return;
        }

        throw new Error(
          data.error || 'Daily task failed'
        );
      }

      const newBalance = Number(data.balance || 0);
      const taskDate =
        data.lastTaskDate ||
        new Date().toISOString().split('T')[0];

      const taskTimestamp =
        new Date().toISOString();

      setBalance(newBalance);
      setCompleted(true);
      setCooldown(
        DAILY_TASK_COOLDOWN_SECONDS
      );

      updateTaskConfirmStage(
        confirmationKey,
        0
      );

      patchUserCache(userId, {
        balance: newBalance,
        [cacheField]: taskDate,
        [timestampCacheField]:
          taskTimestamp,
      });
    } catch (error) {
      console.error('Daily task failed:', error);

      updateTaskConfirmStage(
        confirmationKey,
        0
      );

      alert('❌ Daily task failed. Please try again.');
    } finally {
      setVerifying(false);
    }
  };

  const handleDailyTwitter = async () => {
    await runTaskConfirmationFlow({
      key: 'dailyTwitter',
      link: dailyTwitterLink,
      completed: dailyTwitterDone,
      busy: verifyingTwitter,
      onFinalConfirm: async () => {
        await claimDailyTask({
          task: 'twitter',
          completed: dailyTwitterDone,
          verifying: verifyingTwitter,
          setCompleted: setDailyTwitterDone,
          setVerifying: setVerifyingTwitter,
          setCooldown: setDailyTwitterCooldown,
          cacheField: 'lastTwitterTask',
          timestampCacheField:
            'lastTwitterTaskAt',
          confirmationKey: 'dailyTwitter',
        });
      },
    });
  };

  const handleDailyTelegram = async () => {
    await runTaskConfirmationFlow({
      key: 'dailyTelegram',
      link: dailyTelegramLink,
      completed: dailyTelegramDone,
      busy: verifyingTelegram,
      onFinalConfirm: async () => {
        await claimDailyTask({
          task: 'telegram',
          completed: dailyTelegramDone,
          verifying: verifyingTelegram,
          setCompleted: setDailyTelegramDone,
          setVerifying: setVerifyingTelegram,
          setCooldown: setDailyTelegramCooldown,
          cacheField: 'lastTelegramTask',
          timestampCacheField:
            'lastTelegramTaskAt',
          confirmationKey: 'dailyTelegram',
        });
      },
    });
  };

  // Existing +150 APXN rewarded-ad task remains unchanged.
  const handleWatchAdReward = async () => {
    if (
      !isDataLoaded ||
      !isAdRewardStatusLoaded ||
      isWatchingAd ||
      isWatchingBoostAd ||
      isWatchingRestartAd ||
      adRewardCooldown > 0
    ) {
      return;
    }

    const initData =
      typeof window !== 'undefined'
        ? window.Telegram?.WebApp?.initData
        : null;

    if (!initData) {
      alert('❌ Please open Apex Miner inside Telegram.');
      return;
    }

    if (
      typeof window.show_11803132 !==
      'function'
    ) {
      alert(
        '⚠️ Ad is not ready yet. Please try again in a moment.'
      );
      return;
    }

    setIsWatchingAd(true);

    try {
      // Monetag resolves this promise after its rewarded
      // interstitial flow completes on the client.
      await window.show_11803132();

      const response = await fetch('/api/ads/reward', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ initData }),
        cache: 'no-store',
      });

      const data = await response.json();

      if (!response.ok) {
        if (
          response.status === 429 &&
          data.retryAfter
        ) {
          const retryAfter =
            Math.max(
              1,
              Number(data.retryAfter || 0)
            );

          const syncedBalance =
            Number(data.balance);

          setAdRewardCooldown(
            retryAfter
          );

          if (
            Number.isFinite(
              syncedBalance
            )
          ) {
            setBalance(
              syncedBalance
            );
          }

          patchUserCache(userId, {
            ...(Number.isFinite(syncedBalance)
              ? { balance: syncedBalance }
              : {}),
            lastAdRewardAt:
              data.lastAdRewardAt || null,
            adRewardCount:
              Number(
                data.adRewardCount || 0
              ),
          });

          return;
        }

        throw new Error(
          data.error ||
          'Ad reward failed'
        );
      }

      const newBalance =
        Number(data.balance || 0);

      const lastAdRewardAt =
        data.lastAdRewardAt ||
        new Date().toISOString();

      setBalance(
        newBalance
      );

      setAdRewardCooldown(
        Number(
          data.cooldown ||
          AD_REWARD_COOLDOWN_SECONDS
        )
      );

      patchUserCache(userId, {
        balance: newBalance,
        lastAdRewardAt,
        adRewardCount:
          Number(
            data.adRewardCount || 0
          ),
      });

      alert(
        '✅ +150 APXN added to your balance!'
      );
    } catch (error) {
      console.error(
        'Rewarded ad failed:',
        error
      );

      alert(
        '❌ Ad was not completed. No reward was claimed.'
      );
    } finally {
      setIsWatchingAd(false);
    }
  };

  const handleWatchMiningBoost = async () => {
    if (
      !isDataLoaded ||
      !isMiningBoostStatusLoaded ||
      !miningEventStatusLoaded ||
      isMiningEventActive ||
      !miningEventBoostEnabled ||
      isWatchingBoostAd ||
      isWatchingAd ||
      isWatchingRestartAd ||
      miningBoostRemaining > 0
    ) {
      return;
    }

    const initData =
      typeof window !== 'undefined'
        ? window.Telegram?.WebApp?.initData
        : null;

    if (!initData) {
      alert('❌ Please open Apex Miner inside Telegram.');
      return;
    }

    if (
      typeof window.show_11803132 !==
      'function'
    ) {
      alert(
        '⚠️ Ad is not ready yet. Please try again in a moment.'
      );
      return;
    }

    setIsWatchingBoostAd(true);

    try {
      await window.show_11803132();

      const response = await fetch('/api/ads/boost', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ initData }),
        cache: 'no-store',
      });

      const data = await response.json();

      if (!response.ok) {
        if (
          response.status === 409 &&
          data.active
        ) {
          const boostStartedAt =
            data.boostStartedAt || null;

          const boostUntil =
            data.boostUntil || null;

          const retryAfter =
            Math.max(
              1,
              Number(
                data.retryAfter ||
                getEventAwareMiningBoostRemaining({
                  boostStartedAt,
                  boostUntil,
                  eventStartsAt:
                    miningEventStartsAt,
                  eventEndsAt:
                    miningEventEndsAt,
                  nowTime:
                    getAuthoritativeNowTime(),
                }) ||
                MINING_BOOST_DURATION_SECONDS
              )
            );

          setMiningBoostStartedAt(
            boostStartedAt
          );
          setMiningBoostUntil(
            boostUntil
          );
          setMiningBoostRemaining(
            retryAfter
          );

          setTotalMiningRate(
            getEffectiveMiningRate(
              dbMiningRate,
              activeFriendsCount,
              true
            )
          );

          patchUserCache(userId, {
            miningBoostStartedAt:
              boostStartedAt,
            miningBoostUntil:
              boostUntil,
            miningBoostCount:
              Number(data.boostCount || 0),
            totalMiningRate:
              getEffectiveMiningRate(
                dbMiningRate,
                activeFriendsCount,
                true
              ),
          });

          alert(
            '⚡ Your x3 Mining Boost is already active.'
          );

          return;
        }

        if (
          data.eventActive ||
          data.errorCode === 'EVENT_ACTIVE'
        ) {
          await refreshMiningEventState();
          return;
        }

        throw new Error(
          data.error ||
          'Mining boost activation failed'
        );
      }

      const boostStartedAt =
        data.boostStartedAt ||
        new Date().toISOString();

      const boostUntil =
        data.boostUntil ||
        new Date(
          Date.now() +
          MINING_BOOST_DURATION_SECONDS * 1000
        ).toISOString();

      const remaining =
        getEventAwareMiningBoostRemaining({
          boostStartedAt,
          boostUntil,
          eventStartsAt:
            miningEventStartsAt,
          eventEndsAt:
            miningEventEndsAt,
          nowTime:
            getAuthoritativeNowTime(),
        }) ||
        MINING_BOOST_DURATION_SECONDS;

      const boostedMiningRate =
        getEffectiveMiningRate(
          dbMiningRate,
          activeFriendsCount,
          true
        );

      setMiningBoostStartedAt(
        boostStartedAt
      );
      setMiningBoostUntil(
        boostUntil
      );
      setMiningBoostRemaining(
        remaining
      );

      setTotalMiningRate(
        boostedMiningRate
      );

      patchUserCache(userId, {
        miningBoostStartedAt:
          boostStartedAt,
        miningBoostUntil:
          boostUntil,
        miningBoostCount:
          Number(data.boostCount || 0),
        totalMiningRate:
          boostedMiningRate,
      });

      alert(
        '⚡ x3 Mining Boost activated for 24 hours!'
      );
    } catch (error) {
      console.error(
        'Mining boost ad failed:',
        error
      );

      alert(
        '❌ Ad was not completed. Mining Boost was not activated.'
      );
    } finally {
      setIsWatchingBoostAd(false);
    }
  };

  const claimSocialTask = async ({
    task,
    completed,
    setCompleted,
    cacheField,
    confirmationKey,
  }) => {
    if (
      !isDataLoaded ||
      completed ||
      isSaving
    ) {
      return;
    }

    const initData =
      typeof window !== 'undefined'
        ? window.Telegram?.WebApp?.initData
        : null;

    if (!initData) {
      alert('❌ Please open Apex Miner inside Telegram.');
      return;
    }

    setIsSaving(true);

    try {
      const response = await fetch('/api/tasks/social', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          initData,
          task,
        }),
        cache: 'no-store',
      });

      const data = await response.json();

      if (!response.ok) {
        if (
          response.status === 409 &&
          data.completed
        ) {
          const syncedBalance = Number(data.balance);

          if (Number.isFinite(syncedBalance)) {
            setBalance(syncedBalance);
          }

          setCompleted(true);
          updateTaskConfirmStage(
            confirmationKey,
            0
          );

          patchUserCache(userId, {
            ...(Number.isFinite(syncedBalance)
              ? { balance: syncedBalance }
              : {}),
            [cacheField]: true,
          });

          return;
        }

        throw new Error(
          data.error || 'Task claim failed'
        );
      }

      const newBalance = Number(data.balance || 0);

      setBalance(newBalance);
      setCompleted(true);
      updateTaskConfirmStage(
        confirmationKey,
        0
      );

      patchUserCache(userId, {
        balance: newBalance,
        [cacheField]: true,
      });
    } catch (error) {
      console.error('Social task failed:', error);

      updateTaskConfirmStage(
        confirmationKey,
        0
      );

      const message =
        error?.message ||
        'Task failed. Please try again.';

      alert(`❌ ${message}`);
    } finally {
      setIsSaving(false);
    }
  };

  const handleJoinChannel = async () => {
    await runTaskConfirmationFlow({
      key: 'channel',
      link: 'https://t.me/ApexMiner_Official',
      completed: taskCompleted,
      busy: isSaving,
      onFinalConfirm: async () => {
        await claimSocialTask({
          task: 'channel',
          completed: taskCompleted,
          setCompleted: setTaskCompleted,
          cacheField: 'channelJoined',
          confirmationKey: 'channel',
        });
      },
    });
  };

  const handleJoinGroup = async () => {
    await runTaskConfirmationFlow({
      key: 'group',
      link: 'https://t.me/ApexMinerGroup',
      completed: groupTaskCompleted,
      busy: isSaving,
      onFinalConfirm: async () => {
        await claimSocialTask({
          task: 'group',
          completed: groupTaskCompleted,
          setCompleted: setGroupTaskCompleted,
          cacheField: 'groupJoined',
          confirmationKey: 'group',
        });
      },
    });
  };

  const handleFollowTwitter = async () => {
    await runTaskConfirmationFlow({
      key: 'twitter',
      link: 'https://x.com/ApexNetworkApp',
      completed: twitterTaskCompleted,
      busy: isSaving,
      onFinalConfirm: async () => {
        await claimSocialTask({
          task: 'twitter',
          completed: twitterTaskCompleted,
          setCompleted: setTwitterTaskCompleted,
          cacheField: 'twitterJoined',
          confirmationKey: 'twitter',
        });
      },
    });
  };

  const handleInviteFriend = () => {
    const inviteLink = `https://t.me/ApxMinerBot/app?startapp=${userId}`;
    const shareText = "🚀 Join Apex Network on BSC and mine $APXN Points! Early pioneer welcome bonus active:";
    window.open(`https://t.me/share/url?url=${encodeURIComponent(inviteLink)}&text=${encodeURIComponent(shareText)}`, '_blank');
  };

  const handleCopyLink = () => {
    navigator.clipboard.writeText(`https://t.me/ApxMinerBot/app?startapp=${userId}`);
    alert("✅ Invite link copied!");
  };

  const handleCopyEmail = () => {
    navigator.clipboard.writeText("contact@apxn.network");
    alert("✅ Email address copied to clipboard!");
  };

  const formatTime = (totalSeconds) => {
    const safeSeconds = Math.max(
      0,
      Math.floor(Number(totalSeconds) || 0)
    );

    const h = Math.floor(safeSeconds / 3600);
    const m = Math.floor((safeSeconds % 3600) / 60);
    const s = safeSeconds % 60;

    return `${h.toString().padStart(2, '0')}:${m
      .toString()
      .padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  };

  return (
    <main className="flex min-h-screen flex-col items-center bg-slate-950 font-sans overflow-hidden relative pb-28">
      {showStarsBoostModal && (
        <div className="fixed inset-0 z-[260] flex items-center justify-center bg-black/85 backdrop-blur-md p-4">
          <div className="relative w-full max-w-sm overflow-hidden rounded-[28px] border border-fuchsia-400/50 bg-slate-950 p-6 text-center shadow-[0_0_55px_rgba(217,70,239,0.28)]">
            <div className="pointer-events-none absolute -left-16 -top-16 h-40 w-40 rounded-full bg-fuchsia-500/20 blur-3xl"></div>
            <div className="pointer-events-none absolute -bottom-16 -right-16 h-40 w-40 rounded-full bg-yellow-400/20 blur-3xl"></div>

            <button
              onClick={() => {
                if (!isBuyingStarsBoost) {
                  setShowStarsBoostModal(false);
                }
              }}
              className="absolute right-4 top-4 z-10 text-xl text-gray-400 transition-colors hover:text-white"
              aria-label="Close 48H boost"
            >
              ✖
            </button>

            <div className="relative z-10">
              <div className="mx-auto mb-4 flex h-24 w-24 items-center justify-center rounded-full border border-fuchsia-300/70 bg-gradient-to-br from-violet-700 via-fuchsia-600 to-amber-400 shadow-[0_0_32px_rgba(217,70,239,0.55)]">
                <div className="relative text-5xl drop-shadow-[0_0_10px_rgba(255,255,255,0.75)]">
                  ⛏️
                  <span className="absolute -right-4 -top-3 text-3xl drop-shadow-[0_0_10px_rgba(250,204,21,0.9)]">
                    ⚡
                  </span>
                </div>
              </div>

              <div className="text-[10px] font-black uppercase tracking-[0.28em] text-fuchsia-300">
                APXN 48H Mining Boost
              </div>

              <h3 className="mt-2 text-3xl font-black text-white">
                {visibleStarsBoostReward}
              </h3>

              <div className="mt-4 grid grid-cols-2 gap-3">
                <div className="rounded-2xl border border-yellow-400/30 bg-yellow-400/10 p-3">
                  <span className="block text-[9px] font-bold uppercase tracking-widest text-yellow-200">
                    Price
                  </span>
                  <span className="mt-1 block text-xl font-black text-yellow-300">
                    10 ⭐
                  </span>
                </div>

                <div className="rounded-2xl border border-fuchsia-400/30 bg-fuchsia-400/10 p-3">
                  <span className="block text-[9px] font-bold uppercase tracking-widest text-fuchsia-200">
                    Duration
                  </span>
                  <span className="mt-1 block text-xl font-black text-fuchsia-300">
                    48H
                  </span>
                </div>
              </div>

              <p className="mt-4 text-xs leading-relaxed text-gray-300">
                Mine <strong className="text-white">5,000 APXN POINTS</strong> progressively during 48 hours with each new purchase.
                Free mining and ad mining remain active.
              </p>

              {isStarsBoostActive ? (
                <div className="mt-5 rounded-2xl border border-emerald-400/40 bg-emerald-400/10 p-4">
                  <div className="text-[10px] font-black uppercase tracking-widest text-emerald-300">
                    Boost Active
                  </div>
                  <div className="mt-1 text-3xl font-black tabular-nums text-white">
                    {formatTime(starsBoostRemaining)}
                  </div>
                  <div className="mt-1 text-[10px] font-bold text-emerald-300">
                    {visibleStarsBoostReward} • 48H
                  </div>
                </div>
              ) : (
                <button
                  onClick={handleBuyStarsBoost}
                  disabled={
                    !isDataLoaded ||
                    isBuyingStarsBoost
                  }
                  className={`mt-5 w-full rounded-2xl py-4 text-base font-black transition-all ${
                    !isDataLoaded ||
                    isBuyingStarsBoost
                      ? 'cursor-wait bg-slate-700 text-gray-300'
                      : 'bg-gradient-to-r from-fuchsia-600 via-violet-600 to-amber-500 text-white shadow-[0_0_28px_rgba(217,70,239,0.35)] active:scale-95'
                  }`}
                >
                  {isBuyingStarsBoost
                    ? 'OPENING TELEGRAM PAYMENT...'
                    : 'BUY FOR 10 ⭐'}
                </button>
              )}

              <div className="mt-3 text-[9px] text-gray-500">
                Payment is processed officially by Telegram Stars.
              </div>
            </div>
          </div>
        </div>
      )}

            {showProfile && (
        <div
          className="fixed inset-0 z-[240] overflow-y-auto text-white"
          style={{
            background:
              'radial-gradient(ellipse at 90% 8%, rgba(67,45,184,0.32), transparent 39%), radial-gradient(ellipse at 7% 68%, rgba(1,99,223,0.16), transparent 48%), #030917',
          }}
        >
          <div className="pointer-events-none fixed right-[-30%] top-[-16%] h-72 w-72 rounded-full bg-violet-700/15 blur-3xl" />
          <div className="pointer-events-none fixed bottom-[-15%] left-[-30%] h-72 w-72 rounded-full bg-blue-600/15 blur-3xl" />

          <div className="relative mx-auto min-h-screen w-full max-w-[560px] px-4 pb-12 pt-6 sm:px-6">
            {/* Keep the existing Close Profile behavior. */}
            <div className="flex items-center justify-between gap-3">
              <button
                type="button"
                onClick={() => setShowProfile(false)}
                aria-label="Close APXN Profile"
                className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border border-blue-300/35 bg-blue-950/30 text-2xl text-white shadow-[0_0_14px_rgba(37,99,235,0.15)] transition-transform active:scale-95"
              >
                ←
              </button>
              <h2 className="min-w-0 text-center text-[17px] font-black tracking-[0.16em] text-white drop-shadow-[0_0_14px_rgba(129,140,248,0.3)] sm:text-xl">
                APXN PROFILE
              </h2>
              <div className="h-11 w-11 shrink-0" aria-hidden="true" />
            </div>

                                      {/* APXN compact premium card — straight, no rotation. */}
            <div className="mt-6 px-1">
              <div className="relative mx-auto w-full max-w-[355px]">
                {/* Thin side edge creates depth without tilting the card. */}
                <div
                  aria-hidden="true"
                  className="pointer-events-none absolute inset-0 translate-x-[3px] translate-y-[5px] rounded-[22px]"
                  style={{
                    background: 'linear-gradient(145deg, #1873b9 0%, #172f74 52%, #7a3bd0 100%)',
                    boxShadow: '3px 8px 20px rgba(0,0,0,0.42)',
                  }}
                />

                <div
                  className="relative rounded-[22px] p-[1.5px]"
                  style={{
                    background: 'linear-gradient(125deg, #9ae5ff 0%, #4a98f7 31%, #8083e4 67%, #ba87e8 100%)',
                    boxShadow: '0 0 12px rgba(61,126,248,0.24), 0 12px 22px rgba(0,0,0,0.46)',
                  }}
                >
                  <div
                    className="relative flex min-h-[188px] aspect-[1.72/1] flex-col justify-between overflow-hidden rounded-[20px] px-4 py-4"
                    style={{
                      background: 'radial-gradient(ellipse at -5% -12%, rgba(43,126,228,0.53), transparent 51%), radial-gradient(ellipse at 108% 114%, rgba(105,50,155,0.48), transparent 56%), linear-gradient(138deg, #102b60 0%, #080f2b 54%, #1d1643 100%)',
                    }}
                  >
                    <div aria-hidden="true" className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-white/55 via-sky-300/25 to-violet-300/30" />
                    <div aria-hidden="true" className="pointer-events-none absolute -right-12 top-5 h-44 w-44 rotate-[35deg] rounded-full border-[11px] border-white/[0.045]" />
                    <div aria-hidden="true" className="pointer-events-none absolute bottom-0 left-0 h-px w-full bg-gradient-to-r from-cyan-300/35 via-transparent to-violet-300/35" />

                    {/* Real Telegram first name, logo and existing optional badge. */}
                    <div className="relative z-10 flex items-start justify-between gap-2">
                      <div className="flex min-w-0 items-center gap-2.5">
                        <img
                          src="/logo2.png"
                          alt="APXN logo"
                          className="h-10 w-10 shrink-0 rounded-xl border border-white/25 object-cover shadow-[0_0_10px_rgba(75,151,247,0.22)]"
                        />
                        <div className="min-w-0">
                          <p className="max-w-[170px] truncate text-[17px] font-extrabold leading-tight text-white sm:text-lg">
                            {firstName && firstName !== 'Unknown' ? firstName : 'APXN Worker'}
                          </p>
                          <p className="mt-1 text-[8px] font-bold tracking-[0.18em] text-sky-200/75">
                            APXN MEMBER
                          </p>
                        </div>
                      </div>
                      {hasEarlyAccessBadge ? (
                        <div className="flex w-[62px] shrink-0 flex-col items-center gap-0.5">
                          <img
                            src="https://apxn.network/apxn-early-access-badge.png"
                            alt="Early Access badge"
                            title="APXN Early Access"
                            className="h-[49px] w-[49px] object-contain drop-shadow-[0_0_6px_rgba(27,255,110,0.22)]"
                          />
                          <span className="whitespace-nowrap rounded-full border border-emerald-400/40 bg-emerald-950/70 px-1.5 py-0.5 text-[7px] font-extrabold text-emerald-200">
                            EARLY ACCESS
                          </span>
                        </div>
                      ) : profileBadgeLoading ? (
                        <span className="text-[9px] text-slate-300/70">Checking…</span>
                      ) : null}
                    </div>

                    {/* Actual mining balance. */}
                    <div className="relative z-10 mt-2 min-w-0">
                      <p className="text-[9px] font-extrabold tracking-[0.18em] text-blue-100/75">
                        MINING BALANCE
                      </p>
                      <p className="mt-1 break-all text-[clamp(1.25rem,5.5vw,1.9rem)] font-black leading-tight tracking-tight text-white [font-variant-numeric:tabular-nums]">
                        {Number(balance || 0).toLocaleString('en-US', {
                          minimumFractionDigits: 4,
                          maximumFractionDigits: 4,
                        })}
                      </p>
                      <div className="mt-2 flex items-end justify-between gap-2">
                        <span className="text-[11px] font-extrabold tracking-wider text-amber-300">
                          APXN POINTS
                        </span>
                        <span className="text-[16px] font-black italic tracking-[0.08em] text-white/90">
                          APXN
                        </span>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>







            {/* Future verified points remain locked until official unlock. */}
            <div className="mt-8 space-y-4">
              <section
                className="relative overflow-hidden rounded-[25px] border border-indigo-400/45 bg-gradient-to-br from-[#10234c] via-[#0a1636] to-[#171039] p-4 shadow-[0_0_18px_rgba(75,91,255,0.14)] sm:p-5"
                aria-label="Verified APXN Points"
              >
                <div className="absolute -right-12 -top-12 h-36 w-36 rounded-full bg-violet-600/15 blur-3xl" aria-hidden="true" />
                <div className="relative flex items-center gap-4">
                  <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-2xl border border-violet-400/70 bg-violet-950/40 text-3xl shadow-[0_0_18px_rgba(155,90,255,0.22)]">
                    🔒
                  </div>
                  <div className="min-w-0">
                    <h3 className="text-[11px] font-black tracking-[0.13em] text-slate-300 sm:text-sm">
                      VERIFIED APXN POINTS
                    </h3>
                    <p className="mt-1 text-2xl font-black text-white">Locked</p>
                    <p className="mt-1 text-sm font-bold text-violet-300">Membership &amp; Loyalty</p>
                  </div>
                </div>
              </section>

              {/* Levels continue to depend on verified points and stay locked. */}
              <section
                className="relative overflow-hidden rounded-[25px] border border-indigo-400/45 bg-gradient-to-br from-[#10234c] via-[#0a1533] to-[#1b103f] p-4 shadow-[0_0_18px_rgba(92,78,226,0.14)] sm:p-5"
                aria-label="APXN Level"
              >
                <div className="flex items-center gap-4">
                  <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-2xl border border-violet-400/70 bg-violet-950/40 text-3xl shadow-[0_0_18px_rgba(155,90,255,0.22)]">
                    🔒
                  </div>
                  <div>
                    <h3 className="text-[11px] font-black tracking-[0.13em] text-slate-300 sm:text-sm">
                      APXN LEVEL
                    </h3>
                    <p className="mt-1 text-2xl font-black text-white">Locked</p>
                  </div>
                </div>
                <div className="mt-5 grid grid-cols-7 gap-1.5 sm:gap-2.5">
                  {['L1', 'L2', 'L3', 'L4', 'L5', 'L6', 'L7'].map((level) => (
                    <div
                      key={level}
                      className="rounded-xl border border-slate-500/65 bg-[#050b1e]/75 py-2.5 text-center text-xs font-black text-slate-400 sm:text-sm"
                    >
                      {level}
                    </div>
                  ))}
                </div>
                <p className="mt-4 text-center text-xs leading-relaxed text-slate-400 sm:text-sm">
                  Levels based on verified APXN Points
                </p>
              </section>
              <section className="mt-4 rounded-[25px] border border-indigo-400/45 bg-gradient-to-br from-[#10234c] to-[#171039] p-4 sm:p-5"
                aria-label="BSC Wallet Address">
                <h3 className="text-sm font-black tracking-wider text-white">🔗 BSC WALLET ADDRESS</h3>
                <p className="mt-2 text-xs leading-relaxed text-slate-300">
                  Save your personal BNB Smart Chain (BEP-20) address for future APXN airdrop claims.
                </p>

                <div className="mt-3 rounded-xl border border-amber-400/35 bg-amber-500/5 p-3 text-[11px] leading-relaxed text-slate-200">
                  <p className="font-bold text-amber-300">⚠️ Important Wallet Notice</p>
                  <p className="mt-1">✅ Use only a personal BSC (BEP-20) address from a self-custody wallet that you own and control.</p>
                  <p className="mt-1">❌ Do not use deposit addresses from centralized exchanges or trading platforms.</p>
                  <p className="mt-1">🔐 Never share your recovery phrase or private key.</p>
                </div>

                <label htmlFor="apxn-bsc-address" className="mt-4 block text-[11px] font-bold text-slate-200">
                  Your BSC Wallet Address
                </label>
                <input id="apxn-bsc-address" aria-label="Your BSC wallet address"
                  type="text" value={bscWalletInput}
                  disabled={!bscWalletLoaded || bscWalletLoading || (Boolean(savedBscWallet) && !bscWalletCanEdit)}
                  onChange={(event) => setBscWalletInput(event.target.value)}
                  placeholder="Paste your personal BSC address (0x...)"
                  autoComplete="off" spellCheck={false}
                  className="mt-2 w-full rounded-xl border border-indigo-400/40 bg-[#050b1e] px-3 py-3 font-mono text-xs text-white outline-none focus:border-yellow-400 disabled:opacity-50" />
                <div className="mt-3 grid grid-cols-2 gap-2">
                  <button type="button" onClick={() => saveBscWallet('save')}
                    disabled={!bscWalletLoaded || bscWalletLoading || Boolean(savedBscWallet)}
                    className="rounded-xl bg-gradient-to-r from-indigo-600 to-violet-600 py-3 text-xs font-black text-white disabled:opacity-40 sm:text-sm">
                    {bscWalletLoading ? 'Please wait...' : 'SAVE WALLET'}
                  </button>
                  <button type="button" onClick={() => saveBscWallet('edit')}
                    disabled={!bscWalletLoaded || bscWalletLoading || !savedBscWallet || !bscWalletCanEdit}
                    className="rounded-xl border border-violet-400/50 bg-violet-800/60 py-3 text-xs font-black text-white disabled:opacity-40 sm:text-sm">
                    ✏️ EDIT WALLET
                  </button>
                </div>

                {savedBscWallet ? (
                  <div className="mt-3 rounded-xl border border-emerald-400/25 bg-emerald-950/20 p-3">
                    <p className="text-[11px] font-bold text-emerald-300">Saved BSC Wallet:</p>
                    <p className="mt-1 break-all font-mono text-xs text-white">{savedBscWallet}</p>
                    {walletVerified ? (
                      <p className="mt-2 text-[11px] font-bold text-emerald-300">✓ Wallet Verified — BSC address registered to your Telegram account.</p>
                    ) : (
                      <p className="mt-2 text-[11px] text-amber-300">Wallet registered to your Telegram account.</p>
                    )}
                  </div>
                ) : null}
                {savedBscWallet && !bscWalletCanEdit && bscWalletNextEditDate ? (
                  <p className="mt-3 text-xs font-medium text-amber-300">
                    Next available wallet edit: {bscWalletNextEditDate}
                  </p>
                ) : (
                  <p className="mt-3 text-[11px] text-slate-300">
                    You can change your saved wallet address once per calendar month.
                  </p>
                )}
                {bscWalletMessage ? <p role="status" className="mt-2 text-xs text-amber-300">{bscWalletMessage}</p> : null}
                <p className="mt-3 text-[11px] leading-relaxed text-slate-400">
                  APXN Wallet Verified confirms that your BSC address is registered to your Telegram account. It does not prove blockchain wallet ownership or guarantee airdrop eligibility.
                </p>
              </section>
            </div>
          </div>
        </div>
      )}



      {showTop20 && (
        <div className="fixed inset-0 z-[260] overflow-y-auto bg-[#030917]/95 text-white">
          <div className="mx-auto min-h-screen max-w-[560px] px-4 pb-12 pt-6">
            <div className="flex items-center justify-between gap-3">
              <button type="button" onClick={() => setShowTop20(false)}
                className="rounded-xl border border-blue-400/40 bg-blue-950/40 px-4 py-2 font-bold">←</button>
              <h2 className="text-lg font-black tracking-wider text-yellow-300">🏆 TOP 20</h2>
              <span className="text-xs text-slate-400">{top20Month}</span>
            </div>
            <p className="mt-5 text-center text-xs text-slate-400">
              Monthly leaderboard • Total APXN Points • Updated once per month
            </p>
            {top20Loading ? <p className="mt-8 text-center text-slate-300">Loading Top 20...</p> : null}
            {top20Error ? <p className="mt-8 text-center text-rose-300">{top20Error}</p> : null}
            {!top20Loading && !top20Error && (
              <div className="mt-6 space-y-2">
                {top20Users.map((user, index) => (
                  <div key={index} className="flex items-center gap-3 rounded-2xl border border-indigo-400/30 bg-slate-900/70 px-4 py-3">
                    <span className="w-8 shrink-0 text-center font-black text-yellow-300">#{user.rank}</span>
                    <span className="shrink-0 text-xl" aria-label={user.country ? `Country: ${user.country}` : 'Country unknown'}>
                      {top20CountryFlag(user.country)}
                    </span>
                    <span className="min-w-0 flex-1 truncate text-sm font-bold text-white">{user.name}</span>
                    <span className="shrink-0 text-right text-xs font-bold text-blue-200">
                      {Number(user.points || 0).toLocaleString('en-US', { maximumFractionDigits: 2 })}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {showWelcome && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/85 backdrop-blur-sm p-4">
          <div className="bg-gradient-to-b from-yellow-900/50 to-slate-900 border border-yellow-500/50 rounded-3xl w-full max-w-sm p-6 relative shadow-[0_0_40px_rgba(234,179,8,0.3)] animate-in zoom-in-90 duration-500 overflow-hidden">
            <div className="flex flex-col items-center text-center relative z-10">
              <div className="w-20 h-20 bg-yellow-500/20 rounded-full flex items-center justify-center mb-4 border border-yellow-400/50 shadow-inner">
                 <span className="text-4xl">🏆</span>
              </div>
              <h2 className="text-2xl font-black text-white mb-2">Welcome to Apex Network!</h2>
              <p className="text-gray-300 text-sm mb-4 leading-relaxed">
                You are one of the early pioneers! As a reward for joining early, you've received a massive welcome bonus.
              </p>
              <div className="bg-black/40 rounded-2xl p-4 w-full border border-yellow-500/30 mb-6">
                 <span className="block text-[10px] text-yellow-400 uppercase tracking-widest mb-1">Early Adopter Bonus</span>
                 <span className="text-4xl font-black text-white">+{welcomeAmount.toLocaleString()}</span>
                 <span className="text-sm text-yellow-500 block font-bold">APXN Points</span>

                 {referralBonusAmount > 0 && (
                   <span className="block text-xs font-bold text-green-400 mt-3 pt-3 border-t border-yellow-900/50">
                     +{referralBonusAmount.toLocaleString()} APXN (Friend Referral)
                   </span>
                 )}
              </div>
              <button onClick={() => setShowWelcome(false)} className="w-full py-4 rounded-xl bg-gradient-to-r from-yellow-500 to-orange-500 text-white font-black text-lg shadow-[0_0_20px_rgba(245,158,11,0.5)] active:scale-95 transition-all">
                Claim & Start Mining ⛏️
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="w-full p-4 z-10 mt-2">
        <div className="w-full flex justify-between items-center">
          <div className="flex items-center gap-2">
            <Image src="/logo2.png" alt="Apex Logo" width={28} height={28} className="rounded-full shadow-[0_0_10px_rgba(234,179,8,0.5)] object-cover" />
            <span className="text-lg font-black text-transparent bg-clip-text bg-gradient-to-r from-yellow-400 to-yellow-600">Apex Network</span>
          </div>

          <button type="button" onClick={() => { setShowTop20(true); void loadTop20(); }}
            className="flex items-center gap-2 rounded-xl border border-yellow-400/50 bg-gradient-to-r from-amber-950/65 to-slate-800 px-3 py-2 text-xs font-black text-yellow-300 shadow-[0_0_16px_rgba(234,179,8,0.15)] active:scale-95">
            <span>🏆</span><span>TOP 20</span>
          </button>
        </div>

        <div className="w-full flex justify-end items-center gap-2 mt-2">
          <button
            type="button"
            onClick={handleOpenProfile}
            className="flex items-center gap-2 rounded-xl border border-violet-400/40 bg-gradient-to-r from-indigo-600 to-violet-600 px-4 py-2 text-xs font-black text-white shadow-[0_0_18px_rgba(124,58,237,0.28)] active:scale-95 transition-all"
          >
            <span className="text-base">👤</span>
            <span>APXN Profile</span>
          </button>
        </div>
      </div>

      {activeTab === 'mine' && (
        <div className="flex-1 w-full flex flex-col items-center px-6">
          <div className="w-full text-center mt-2">
            <h1 className="text-gray-400 text-xs tracking-widest uppercase mb-2">Total Points</h1>
            <h2 className="text-4xl font-bold text-white">
              {balance.toFixed(4)} <span className="text-xl text-yellow-400 font-black">APXN</span>
            </h2>
          </div>

          {isMiningEventActive && (
            <div className="w-full mt-5 rounded-2xl border border-yellow-400/60 bg-gradient-to-r from-yellow-950/70 via-orange-950/60 to-yellow-950/70 p-4 text-center shadow-[0_0_24px_rgba(250,204,21,0.16)]">
              <div className="text-xl font-black text-yellow-300">
                🎉 ✅ APXN
              </div>
              <div className="mt-2 text-[10px] uppercase tracking-[0.2em] text-yellow-100/70 font-bold">
                48H Mining Event
              </div>
              <div className="mt-1 text-3xl font-black text-white tabular-nums">
                {formatTime(miningEventRemaining)}
              </div>
              <div className="mt-1 text-[10px] font-bold text-emerald-400">
                Base speed: +{Number(miningEventBaseRate).toFixed(5)} APXN/sec
              </div>
            </div>
          )}

          <div className="w-full flex flex-col gap-3 mt-6">
            <div className="bg-slate-900/60 border border-slate-800 rounded-2xl p-4 flex justify-between items-center">
               <div className="flex flex-col">
                 <span className="text-gray-400 text-sm font-medium">TOTAL MINING SPEED</span>
                 {activeFriendsCount > 0 && <span className="text-[9px] text-green-400">Includes +5% per active friend</span>}
                 {isMiningBoostActive && (
                   <span className="text-[9px] text-fuchsia-400 font-bold">
                     ⚡ x3 base speed active
                   </span>
                 )}
                 {hasFrozenMiningBoost && (
                   <span className="text-[9px] text-cyan-400 font-bold">
                     ⏸ x3 saved time is frozen
                   </span>
                 )}
                 {isStarsBoostActive && (
                   <span className="text-[9px] text-fuchsia-300 font-bold">
                     ⛏️⚡ {starsBoostStatusLoaded
                       ? `+${activeStarsBoostRate.toFixed(5)} APXN POINTS/sec paid boost`
                       : 'Checking paid boost rate...'}
                   </span>
                 )}
               </div>
               <span className="font-semibold text-yellow-400 text-xs">
                 +{(
                   totalMiningRate +
                   (isStarsBoostActive
                     ? activeStarsBoostRate
                     : 0)
                 ).toFixed(5)} APXN/sec
               </span>
            </div>

            <div className={`rounded-2xl p-4 flex items-center justify-between border ${
              isMiningEventActive
                ? 'bg-cyan-950/20 border-cyan-500/40 shadow-[0_0_18px_rgba(6,182,212,0.10)]'
                : isMiningBoostActive
                ? 'bg-fuchsia-950/30 border-fuchsia-500/50 shadow-[0_0_18px_rgba(217,70,239,0.12)]'
                : 'bg-slate-900/60 border-slate-800'
            }`}>
              <div className="flex flex-col pr-3">
                <span className="text-white text-sm font-black">⚡ x3 Mining Boost</span>
                <span className="text-[10px] text-gray-400 mt-1">
                  {isMiningEventActive
                    ? hasFrozenMiningBoost
                      ? `Frozen • ${formatTime(miningBoostRemaining)} saved`
                      : 'Temporarily frozen during the APXN 48h event'
                    : isMiningBoostActive
                    ? `Active • ${formatTime(miningBoostRemaining)} left`
                    : 'Watch an ad → x3 base mining speed for 24h'}
                </span>
              </div>

              <button
                onClick={handleWatchMiningBoost}
                disabled={
                  !isDataLoaded ||
                  !isMiningBoostStatusLoaded ||
                  !miningEventStatusLoaded ||
                  isMiningEventActive ||
                  !miningEventBoostEnabled ||
                  isWatchingBoostAd ||
                  isWatchingAd ||
                  isWatchingRestartAd ||
                  isMiningBoostActive
                }
                className={`px-4 py-2 rounded-xl text-xs font-black min-w-[84px] transition-all ${
                  isMiningEventActive
                    ? 'bg-cyan-600/20 text-cyan-300 border border-cyan-500/40 cursor-not-allowed'
                    : isMiningBoostActive
                    ? 'bg-fuchsia-600/30 text-fuchsia-300 border border-fuchsia-500/40 cursor-not-allowed'
                    : (!isDataLoaded || !isMiningBoostStatusLoaded || !miningEventStatusLoaded || isWatchingBoostAd || isWatchingAd || isWatchingRestartAd)
                    ? 'bg-slate-700 text-gray-300 animate-pulse'
                    : 'bg-gradient-to-r from-fuchsia-600 to-purple-600 text-white active:scale-95'
                }`}
              >
                {!isDataLoaded || !isMiningBoostStatusLoaded || !miningEventStatusLoaded
                  ? 'Wait..'
                  : isMiningEventActive
                  ? 'FROZEN'
                  : isWatchingBoostAd
                  ? 'Ad...'
                  : isWatchingAd || isWatchingRestartAd
                  ? 'Wait..'
                  : isMiningBoostActive
                  ? 'ACTIVE'
                  : 'WATCH'}
              </button>
            </div>
          </div>

          <div className="mt-8 text-center">
             <h3 className="text-5xl font-black text-yellow-400 drop-shadow-[0_0_15px_rgba(250,204,21,0.6)] tabular-nums">
               +{miningDelta.toFixed(4)}
             </h3>
             <div className={`mt-2 text-[11px] font-bold ${
               isMiningPaused && !isStarsBoostActive
                 ? 'text-red-400'
                 : 'text-emerald-400'
             }`}>
               {isMiningPaused
                 ? (
                     isStarsBoostActive
                       ? `⚡ 48H Stars Boost Active • ${formatTime(starsBoostRemaining)} left`
                       : '⏸ Mining Paused • Restart to claim points'
                   )
                 : `● Mining Active • ${formatTime(miningSessionRemaining)} left`}
             </div>
             {isStarsBoostActive && !isMiningPaused && (
               <div className="mt-1 text-[10px] font-black text-fuchsia-300">
                 ⛏️⚡ {visibleStarsBoostReward} Boost • {formatTime(starsBoostRemaining)}
               </div>
             )}
          </div>

          <div className="flex-1 flex items-center justify-center my-8 relative w-full">
            <div className="absolute inset-0 bg-yellow-500 blur-[80px] opacity-20 rounded-full"></div>
            <StakingWidget
              userId={userId}
              isDataLoaded={isDataLoaded}
              onBalanceUpdate={(nextBalance) => {
                setBalance(nextBalance);
                patchUserCache(userId, { balance: nextBalance });
              }}
              openStarsBoost={() => setShowStarsBoostModal(true)}
            />

            <div className="w-56 h-56 rounded-full p-[4px] bg-gradient-to-b from-yellow-300 via-yellow-500 to-yellow-800 shadow-[0_0_50px_rgba(234,179,8,0.4),inset_0_0_20px_rgba(255,255,255,0.5)] z-10 flex items-center justify-center relative">
              <div className="w-full h-full rounded-full border-[6px] border-slate-950 overflow-hidden shadow-[inset_0_0_30px_rgba(0,0,0,0.8)] relative">
                 <Image src="/logo2.png" alt="Apex Coin" width={200} height={200} className="w-full h-full object-cover rounded-full drop-shadow-[0_0_15px_rgba(255,255,255,0.2)]" />
                 <div className="absolute inset-0 bg-gradient-to-tr from-transparent via-white/10 to-transparent rounded-full pointer-events-none"></div>
              </div>
            </div>

            <button
              type="button"
              onClick={() =>
                setShowStarsBoostModal(true)
              }
              className="absolute left-2 bottom-0 translate-y-4 z-20 flex flex-col items-center justify-center gap-1 group"
              aria-label="APXN 48H Mining Boost"
            >
              <div className={`relative flex h-12 w-12 items-center justify-center rounded-full border transition-all duration-300 group-hover:scale-110 ${
                isStarsBoostActive
                  ? 'border-emerald-300/80 bg-gradient-to-br from-emerald-600 via-fuchsia-600 to-amber-400 shadow-[0_0_24px_rgba(52,211,153,0.55)]'
                  : 'border-fuchsia-300/70 bg-gradient-to-br from-violet-700 via-fuchsia-600 to-amber-400 shadow-[0_0_24px_rgba(217,70,239,0.55)]'
              }`}>
                <span className="text-2xl drop-shadow-[0_0_8px_rgba(255,255,255,0.8)]">
                  ⛏️
                </span>
                <span className="absolute -right-1 -top-2 text-lg drop-shadow-[0_0_8px_rgba(250,204,21,0.95)]">
                  ⚡
                </span>
              </div>
              <span className={`text-[10px] font-black transition-colors ${
                isStarsBoostActive
                  ? 'text-emerald-300'
                  : 'text-fuchsia-300 group-hover:text-white'
              }`}>
                {isStarsBoostActive
                  ? 'ACTIVE'
                  : '10 ⭐'}
              </span>
            </button>

            <a
              href="https://x.com/ApexNetworkApp"
              target="_blank"
              rel="noopener noreferrer"
              className="absolute right-2 bottom-0 translate-y-4 z-20 flex flex-col items-center justify-center gap-1 group"
            >
              <div className="w-12 h-12 bg-black border border-slate-700 rounded-full flex items-center justify-center shadow-[0_0_15px_rgba(255,255,255,0.1)] group-hover:bg-slate-900 group-hover:scale-110 transition-all duration-300">
                <svg viewBox="0 0 24 24" aria-hidden="true" className="w-5 h-5 fill-white">
                  <g><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"></path></g>
                </svg>
              </div>
              <span className="text-[10px] font-bold text-gray-400 group-hover:text-white transition-colors">Follow</span>
            </a>
          </div>

          <button
            onClick={handleClaim}
            disabled={
              !isDataLoaded ||
              isSaving ||
              isWatchingRestartAd ||
              isWatchingAd ||
              isWatchingBoostAd ||
              !isMiningPaused
            }
            className={`w-full py-4 mt-auto mb-4 rounded-2xl text-lg font-bold shadow-[0_4px_20px_rgba(245,158,11,0.4)] transition-all ${
              !isDataLoaded
                ? 'bg-slate-800 text-gray-500 cursor-wait'
                : (isSaving || isWatchingRestartAd || isWatchingAd || isWatchingBoostAd)
                ? 'bg-slate-700 text-gray-300 animate-pulse'
                : !isMiningPaused
                ? 'bg-slate-800 border border-slate-700 text-gray-400 cursor-not-allowed shadow-none'
                : 'bg-gradient-to-r from-yellow-500 to-orange-600 text-white active:scale-95'
            }`}
          >
            {!isDataLoaded
              ? 'LOADING...'
              : isWatchingRestartAd
                ? 'WATCHING RESTART AD...'
                : isSaving
                  ? (
                      isMiningPaused
                        ? 'RESTARTING...'
                        : 'CLAIMING...'
                    )
                  : (isWatchingAd || isWatchingBoostAd)
                    ? 'WAIT...'
                    : isMiningPaused
                      ? 'RESTART MINING'
                      : `MINING ACTIVE • ${formatTime(miningSessionRemaining)}`
            }
          </button>
        </div>
      )}

      {activeTab === 'tasks' && (
        <div className="flex-1 w-full flex flex-col px-6 pt-4 overflow-y-auto">
          <div className="bg-gradient-to-br from-yellow-600 to-orange-600 rounded-2xl p-5 mb-6 relative overflow-hidden shadow-[0_0_20px_rgba(245,158,11,0.3)]">
            <div className="relative z-10 flex flex-col items-center">
              <h3 className="font-black text-white text-2xl mb-1 drop-shadow-md">Daily Check-In</h3>
              <p className="text-yellow-100 text-[11px] text-center mb-4 font-medium leading-relaxed">
                {dailyCheckinV2Enabled ? (
                  <>
                    Check in every day to earn your daily reward.<br/>
                    <span className="font-bold text-white">Missing a day pauses rewards until you complete 2 consecutive active days.</span>
                  </>
                ) : (
                  <>
                    Log in daily to increase your reward.<br/>
                    <span className="font-bold text-white">Missing a day resets your streak to 0!</span>
                  </>
                )}
              </p>
              <div className="flex items-center justify-center gap-3 mb-4 w-full">
                 <div className="flex-1 bg-black/20 rounded-xl px-2 py-3 text-center backdrop-blur-sm border border-white/10">
                    <span className="block text-[9px] text-yellow-200 uppercase tracking-widest mb-1">
                      {dailyCheckinV2Enabled ? 'Active Days' : 'Current Streak'}
                    </span>
                    <span className="text-2xl font-black text-white">
                      {dailyCheckinV2Enabled ? activeDays : checkinStreak} <span className="text-sm">Days</span>🔥
                    </span>
                 </div>
                 <div className="flex-1 bg-black/20 rounded-xl px-2 py-3 text-center backdrop-blur-sm border border-white/10">
                    <span className="block text-[9px] text-yellow-200 uppercase tracking-widest mb-1">
                      {dailyCheckinV2Enabled
                        ? (canCheckIn ? "Today's Reward" : 'Daily Reward')
                        : (canCheckIn ? "Today's Reward" : "Tomorrow's Reward")}
                    </span>
                    <span className="text-2xl font-black text-yellow-400">+{dailyRewardAmt}</span>
                 </div>
              </div>

              {dailyCheckinV2Enabled && checkinRecoveryDays < 2 && (
                <div className="w-full mb-4 rounded-xl border border-white/15 bg-black/20 px-3 py-2 text-center">
                  <span className="text-[10px] font-black uppercase tracking-widest text-yellow-100">
                    Recovery: {checkinRecoveryDays}/2 Active Days
                  </span>
                  {!checkinRewardEligible && (
                    <span className="block mt-1 text-[10px] font-bold text-white">
                      Daily reward is paused today.
                    </span>
                  )}
                </div>
              )}

              <button onClick={handleDailyCheckIn} disabled={!isDataLoaded || !canCheckIn || isSaving} className={`w-full py-3 rounded-xl text-base font-black uppercase tracking-wider transition-all shadow-lg ${(isDataLoaded && canCheckIn) ? 'bg-white text-orange-600 hover:scale-105 active:scale-95' : 'bg-black/30 text-white/50 cursor-not-allowed border border-white/10'}`}>
                {!isDataLoaded
                  ? 'Loading...'
                  : isSaving
                    ? (dailyCheckinV2Enabled ? 'Checking In...' : 'Claiming...')
                    : canCheckIn
                      ? (
                          dailyCheckinV2Enabled
                            ? (dailyRewardAmt > 0 ? 'Claim +100 APXN' : 'Check In • Recovery')
                            : 'Claim Reward'
                        )
                      : 'Come Back Tomorrow'}
              </button>
            </div>
          </div>

          <h2 className="text-2xl font-bold text-white mb-4">Daily Tasks</h2>

          <div className="flex flex-col gap-4 mb-6">
            <div className="bg-slate-900/80 border border-yellow-500/30 rounded-2xl p-4 flex items-center justify-between">
              <div>
                <h3 className="font-bold text-white text-lg">Watch Rewarded Ad</h3>
                <p className="text-yellow-400 text-xs">+150 APXN Points</p>

                {adRewardCooldown > 0 && (
                  <p className="text-gray-500 text-[10px] mt-1">
                    Available in {formatTime(adRewardCooldown)}
                  </p>
                )}
              </div>

              <button
                onClick={handleWatchAdReward}
                disabled={
                  !isDataLoaded ||
                  !isAdRewardStatusLoaded ||
                  isWatchingAd ||
                  isWatchingBoostAd ||
                  isWatchingRestartAd ||
                  adRewardCooldown > 0
                }
                className={`px-4 py-2 rounded-xl text-white text-sm font-bold transition-colors min-w-[80px] ${
                  adRewardCooldown > 0
                    ? 'bg-green-600'
                    : (!isDataLoaded || !isAdRewardStatusLoaded || isWatchingAd || isWatchingBoostAd || isWatchingRestartAd)
                    ? 'bg-slate-700 animate-pulse'
                    : 'bg-gradient-to-r from-yellow-500 to-orange-600 active:scale-95'
                }`}
              >
                {!isDataLoaded || !isAdRewardStatusLoaded
                  ? 'Wait..'
                  : isWatchingAd
                  ? 'Ad...'
                  : isWatchingBoostAd || isWatchingRestartAd
                  ? 'Wait..'
                  : adRewardCooldown > 0
                  ? 'Done ✓'
                  : 'WATCH'}
              </button>
            </div>
            {dailyTelegramLink && (
            <div className="bg-slate-900/80 border border-slate-800 rounded-2xl p-4 flex items-center justify-between">
              <div>
                <h3 className="font-bold text-white text-lg">Like Today's Post</h3>
                <p className="text-yellow-400 text-xs">+100 APXN Points</p>
                {dailyTelegramCooldown > 0 && (
                  <p className="text-gray-500 text-[10px] mt-1">
                    Available in {formatTime(dailyTelegramCooldown)}
                  </p>
                )}
              </div>
              <button onClick={handleDailyTelegram} disabled={!isDataLoaded || dailyTelegramDone || verifyingTelegram} className={`${dailyTelegramDone ? 'bg-green-600' : (!isDataLoaded || verifyingTelegram) ? 'bg-slate-700 animate-pulse' : 'bg-[#2AABEE]'} px-4 py-2 rounded-xl text-white text-sm font-bold active:scale-95 transition-colors min-w-[80px]`}>
                {getTaskConfirmLabel({
                  key: 'dailyTelegram',
                  completed: dailyTelegramDone,
                  loading: !isDataLoaded || verifyingTelegram,
                })}
              </button>
            </div>
            )}

            {dailyTwitterLink && (
            <div className="bg-slate-900/80 border border-slate-800 rounded-2xl p-4 flex items-center justify-between relative overflow-hidden">
              <div className="absolute top-0 right-0 w-2 h-full bg-slate-700"></div>
              <div>
                <h3 className="font-bold text-white text-lg flex items-center gap-2">
                  Like Today's X Post
                  <svg viewBox="0 0 24 24" aria-hidden="true" className="w-4 h-4 fill-white"><g><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"></path></g></svg>
                </h3>
                <p className="text-yellow-400 text-xs">+100 APXN Points</p>
                {dailyTwitterCooldown > 0 && (
                  <p className="text-gray-500 text-[10px] mt-1">
                    Available in {formatTime(dailyTwitterCooldown)}
                  </p>
                )}
              </div>
              <button onClick={handleDailyTwitter} disabled={!isDataLoaded || dailyTwitterDone || verifyingTwitter} className={`${dailyTwitterDone ? 'bg-green-600' : (!isDataLoaded || verifyingTwitter) ? 'bg-slate-700 animate-pulse' : 'bg-black border border-slate-700'} px-4 py-2 rounded-xl text-white text-sm font-bold active:scale-95 transition-colors min-w-[80px]`}>
                {getTaskConfirmLabel({
                  key: 'dailyTwitter',
                  completed: dailyTwitterDone,
                  loading: !isDataLoaded || verifyingTwitter,
                })}
              </button>
            </div>
            )}
          </div>

          <h2 className="text-2xl font-bold text-white mb-4">One-Time Social Tasks</h2>

          <div className="flex flex-col gap-4 mb-8">
            <div className="bg-slate-900/80 border border-slate-800 rounded-2xl p-4 flex items-center justify-between">
              <div>
                <h3 className="font-bold text-white text-lg">Join Telegram Channel</h3>
                <p className="text-yellow-400 text-xs">+500 APXN Points</p>
              </div>
              <button onClick={handleJoinChannel} disabled={!isDataLoaded || taskCompleted || isSaving} className={`${taskCompleted ? 'bg-green-600' : (!isDataLoaded || isSaving) ? 'bg-slate-700' : 'bg-[#2AABEE]'} px-4 py-2 rounded-xl text-white text-sm font-bold active:scale-95 transition-colors min-w-[80px]`}>
                {getTaskConfirmLabel({
                  key: 'channel',
                  completed: taskCompleted,
                  loading: !isDataLoaded || isSaving,
                })}
              </button>
            </div>

            <div className="bg-slate-900/80 border border-slate-800 rounded-2xl p-4 flex items-center justify-between">
              <div>
                <h3 className="font-bold text-white text-lg">Join Telegram Group</h3>
                <p className="text-yellow-400 text-xs">+500 APXN Points</p>
              </div>
              <button onClick={handleJoinGroup} disabled={!isDataLoaded || groupTaskCompleted || isSaving} className={`${groupTaskCompleted ? 'bg-green-600' : (!isDataLoaded || isSaving) ? 'bg-slate-700' : 'bg-[#229ED9]'} px-4 py-2 rounded-xl text-white text-sm font-bold active:scale-95 transition-colors min-w-[80px]`}>
                {getTaskConfirmLabel({
                  key: 'group',
                  completed: groupTaskCompleted,
                  loading: !isDataLoaded || isSaving,
                })}
              </button>
            </div>

            <div className="bg-slate-900/80 border border-slate-800 rounded-2xl p-4 flex items-center justify-between relative overflow-hidden">
              <div className="absolute top-0 right-0 w-2 h-full bg-slate-700"></div>
              <div>
                <h3 className="font-bold text-white text-lg flex items-center gap-2">
                  Follow us on X
                  <svg viewBox="0 0 24 24" aria-hidden="true" className="w-4 h-4 fill-white"><g><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"></path></g></svg>
                </h3>
                <p className="text-yellow-400 text-xs">+500 APXN Points</p>
              </div>
              <button onClick={handleFollowTwitter} disabled={!isDataLoaded || twitterTaskCompleted || isSaving} className={`${twitterTaskCompleted ? 'bg-green-600' : (!isDataLoaded || isSaving) ? 'bg-slate-700' : 'bg-black border border-slate-700'} px-4 py-2 rounded-xl text-white text-sm font-bold active:scale-95 transition-colors min-w-[80px]`}>
                {getTaskConfirmLabel({
                  key: 'twitter',
                  completed: twitterTaskCompleted,
                  loading: !isDataLoaded || isSaving,
                })}
              </button>
            </div>
          </div>
        </div>
      )}

      {activeTab === 'friends' && (
        <div className="flex-1 w-full flex flex-col px-6 pt-4">
          <div className="text-center mb-6 mt-2">
             <h2 className="text-3xl font-bold text-white mb-2">Invite Friends!</h2>
             <p className="text-gray-400 text-xs leading-relaxed">
               Get <span className="text-green-400 font-bold">+5%</span> mining speed for every <span className="text-white">ACTIVE</span> friend.<br/>
               They get <span className="text-yellow-400 font-bold">1,000 Points</span> welcome bonus!
             </p>
          </div>

          <div className="bg-slate-900/80 border border-slate-800 rounded-2xl p-6 text-center flex flex-col gap-4">
             <div className="flex justify-around mb-2">
                <div className="flex flex-col">
                  <span className="text-2xl font-bold text-white">{friendsCount}</span>
                  <span className="text-[10px] text-gray-500 uppercase">Total</span>
                </div>
                <div className="flex flex-col">
                  <span className="text-2xl font-bold text-green-400">{activeFriendsCount}</span>
                  <span className="text-[10px] text-gray-500 uppercase">Active (24h)</span>
                </div>
             </div>
             <button onClick={handleInviteFriend} className="w-full bg-yellow-600 py-3 rounded-xl text-white font-bold text-lg shadow-[0_4px_20px_rgba(202,138,4,0.4)] active:scale-95 transition-all">
               Invite a Friend
             </button>
             <button onClick={handleCopyLink} className="w-full bg-slate-800 py-3 rounded-xl text-gray-300 font-bold active:scale-95 transition-all">
               Copy Invite Link
             </button>
          </div>

          <div className="mt-8 w-full flex flex-col gap-3 pb-8">
            <h3 className="text-white font-bold text-sm border-b border-slate-800 pb-2">My Referrals ({friendsList.length})</h3>
            {friendsList.length === 0 ? (
              <p className="text-gray-500 text-xs text-center mt-4">You haven't invited anyone yet.</p>
            ) : (
              friendsList.map((friend, index) => {
                const isActive = friend.last_claim >= new Date(Date.now() - 86400000).toISOString();
                return (
                  <div key={index} className="bg-slate-900/60 border border-slate-800 rounded-xl p-3 flex justify-between items-center transition-all hover:border-slate-700">
                    <div className="flex items-center gap-3">
                      {getFlagIcon(friend.country)}
                      <span className="text-white font-bold text-sm">{friend.first_name || 'Miner'}</span>
                    </div>
                    <span className={`text-[9px] font-black uppercase tracking-wider px-2 py-1 rounded-md ${isActive ? 'bg-green-500/10 text-green-400 border border-green-500/20' : 'bg-red-500/10 text-red-400 border border-red-500/20'}`}>
                      {isActive ? 'Active' : 'Inactive'}
                    </span>
                  </div>
                );
              })
            )}
          </div>
        </div>
      )}

      {activeTab === 'boosts' && (
        <div className="flex-1 w-full flex flex-col px-4 pt-4 overflow-y-auto">
          <h2 className="text-2xl font-bold text-white mb-2 text-center">Upgrade Store 🛒</h2>

          <div className="mt-2 mb-6 bg-red-900/40 border border-red-500/50 rounded-lg p-4 shadow-lg shadow-red-900/20">
            <div className="flex items-start gap-3">
              <span className="text-xl">⚠️</span>
              <div>
                <h3 className="text-red-400 font-bold text-sm tracking-wide uppercase mb-1">
                  KYC — APXN Membership & Loyalty
                </h3>
                <p className="text-gray-300 text-[11px] leading-relaxed">
                  To participate in the APXN Membership & Loyalty program, users must unlock at least <strong className="text-white bg-red-500/20 px-1 rounded">2 stages in EVERY level</strong>. Completing the required stages will unlock your <strong className="text-yellow-400">Verified APXN Points</strong> and allow you to progress toward higher APXN levels. <span className="text-red-300 font-bold">🔒 This feature is currently Coming Soon.</span>
                </p>
              </div>
            </div>
          </div>
<div className="mb-6 w-full rounded-2xl border border-yellow-400/40 bg-yellow-400/10 p-4 shadow-lg">
  <div className="flex items-center gap-3">
    <span className="text-2xl">🎁</span>

    <div>
      <h3 className="text-yellow-300 font-bold text-sm tracking-wide uppercase">
        Completion Bonus
      </h3>

      <p className="text-white font-bold text-lg mt-1">
        +20,000 APXN Points
      </p>

      <p className="text-gray-300 text-[11px] mt-1 leading-relaxed">
        Complete all levels to receive this bonus.
      </p>
    </div>
  </div>
</div>
          {[
            {
              title: "Level 1: APXN Miners",
              currency: "APXN",
              items: [
                { name: "Nano Miner", price: "5,000", boost: "+0.001/sec" },
                { name: "Micro Rig", price: "10,000", boost: "+0.002/sec" },
                { name: "Mini Core", price: "15,000", boost: "+0.003/sec" },
                { name: "Eco Miner", price: "20,000", boost: "+0.004/sec" }
              ]
            },
            {
              title: "Level 2: Telegram Stars",
              currency: "⭐️ Stars",
              items: [
                { name: "Stellar Rig", price: "10", boost: "+0.006/sec" },
                { name: "Nova Core", price: "20", boost: "+0.007/sec" },
                { name: "Pulsar Miner", price: "30", boost: "+0.008/sec" },
                { name: "Nebula Unit", price: "40", boost: "+0.01/sec" }
              ]
            },
            {
              title: "Level 3: APXN Elite",
              currency: "⭐️ Stars",
              items: [
                { name: "Apex Quantum", price: "50", boost: "+0.03/sec" },
                { name: "Titan Node", price: "60", boost: "+0.04/sec" },
                { name: "Cyber Miner", price: "70", boost: "+0.05/sec" },
                { name: "Genesis Rig", price: "80", boost: "+0.06/sec" }
              ]
            }
          ].map((level, index) => (
            <div key={index} className="mb-8 w-full">
              <h2 className="text-lg font-semibold mb-4 border-b border-slate-700 pb-2 text-white flex items-center gap-2">
                {level.title}
              </h2>

              <div className="grid grid-cols-2 gap-3">
                {level.items.map((item, idx) => (
                  <div
                    key={idx}
                    className="relative bg-slate-900 border border-slate-800 rounded-xl p-3 overflow-hidden grayscale opacity-75 transition-all hover:grayscale-0 hover:opacity-100 shadow-md"
                  >
                    <div className="absolute top-2 right-2 bg-black/80 px-2 py-1 rounded text-[10px] font-bold text-gray-300 backdrop-blur-sm z-10 flex items-center gap-1">
                      🔒 Soon
                    </div>
                    <div className="text-center mt-4">
                      <h3 className="font-bold text-sm text-gray-200">{item.name}</h3>
                      <div className="text-green-400 text-[11px] font-bold mt-1">{item.boost}</div>

                      <button
                        disabled
                        className="mt-3 w-full bg-slate-800 text-gray-400 py-2 rounded-lg text-xs font-bold cursor-not-allowed border border-slate-700"
                      >
                        {item.price} {level.currency}
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {activeTab === 'discover' && (
        <div className="flex-1 w-full flex flex-col overflow-y-auto pb-10">
          <div className="w-full bg-slate-900/95 backdrop-blur-md border-b border-slate-800 sticky top-0 z-20 flex justify-around p-2">
             <button onClick={() => setDiscoverView('about')} className={`py-2 px-4 rounded-lg text-xs font-bold transition-colors ${discoverView === 'about' ? 'bg-yellow-600 text-slate-900' : 'text-gray-400 hover:text-white'}`}>About</button>
             <button onClick={() => setDiscoverView('roadmap')} className={`py-2 px-4 rounded-lg text-xs font-bold transition-colors ${discoverView === 'roadmap' ? 'bg-yellow-600 text-slate-900' : 'text-gray-400 hover:text-white'}`}>Apex Roadmap</button>
             <button onClick={() => setDiscoverView('whitepaper')} className={`py-2 px-4 rounded-lg text-xs font-bold transition-colors ${discoverView === 'whitepaper' ? 'bg-yellow-600 text-slate-900' : 'text-gray-400 hover:text-white'}`}>Whitepaper</button>
          </div>

          {discoverView === 'about' && (
             <div className="w-full flex flex-col items-center pb-6">
                <div className="w-full py-12 bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 border-b border-yellow-500/30 flex flex-col items-center justify-center relative overflow-hidden shadow-2xl">
                   <div className="absolute inset-0 bg-black/40 mix-blend-overlay"></div>
                   <div className="w-20 h-20 bg-yellow-500/20 rounded-full flex items-center justify-center mb-4 border border-yellow-400/50 shadow-[0_0_30px_rgba(234,179,8,0.5)] z-10">
                      <Image src="/logo2.png" alt="Apex Logo" width={60} height={60} className="rounded-full drop-shadow-[0_0_15px_rgba(255,255,255,0.4)] object-cover w-full h-full" />
                   </div>
                   <h1 className="text-4xl font-black text-white mb-2 z-10">Apex Network</h1>
                   <div className="flex gap-2 mt-2 z-10">
                      <span className="flex items-center gap-1 text-yellow-500 font-bold text-[10px] border border-yellow-500/30 px-3 py-1 rounded-full bg-yellow-900/30">
                        <img src="/binance-logo-1.png" alt="Binance" className="w-3 h-3 object-contain" /> BSC BEP-20
                      </span>
                      <span className="flex items-center gap-1 text-cyan-400 font-bold text-[10px] border border-cyan-500/30 px-3 py-1 rounded-full bg-cyan-900/30">
                        <span>🧭</span> APXN ROADMAP
                      </span>
                   </div>
                </div>

                <div className="px-6 w-full mt-8">
                   <p className="text-gray-300 text-sm leading-relaxed mb-8 font-medium text-center">
                     Apex Network is a Telegram-based Web3 ecosystem for mining APXN Points, daily participation and referrals, with a planned DEX, testnet and mainnet.
                   </p>

                   <h2 className="text-2xl font-bold text-white mb-4 border-b border-slate-800 pb-2">Core Features</h2>
                   <div className="grid grid-cols-2 gap-3 mb-8">
                      <div className="bg-slate-900/80 p-4 rounded-xl border border-slate-800 text-center">
                         <span className="text-3xl block mb-2">⚡</span>
                         <h3 className="font-bold text-white text-sm">Cloud Mining</h3>
                         <p className="text-gray-400 text-[10px] mt-1">Automated APXN points generation.</p>
                      </div>
                      <div className="bg-slate-900/80 p-4 rounded-xl border border-slate-800 text-center">
                         <span className="text-3xl block mb-2">🛡️</span>
                         <h3 className="font-bold text-white text-sm">BEP-20 Token</h3>
                         <p className="text-gray-400 text-[10px] mt-1">BSC token contract information is publicly accessible.</p>
                      </div>
                      <div className="bg-slate-900/80 p-4 rounded-xl border border-slate-800 text-center">
                         <span className="text-3xl block mb-2">🚀</span>
                         <h3 className="font-bold text-white text-sm">APXN DEX</h3>
                         <p className="text-gray-400 text-[10px] mt-1">APXN DEX launch planned for Q3 2027.</p>
                      </div>
                      <div className="bg-slate-900/80 p-4 rounded-xl border border-slate-800 text-center">
                         <span className="text-3xl block mb-2">👥</span>
                         <h3 className="font-bold text-white text-sm">Community</h3>
                         <p className="text-gray-400 text-[10px] mt-1">Earn massive referral rewards.</p>
                      </div>
                   </div>

                   <h2 className="text-2xl font-bold text-white mb-4 border-b border-slate-800 pb-2">Join Our Community</h2>
                   <div className="flex flex-col gap-3 w-full mb-8">
                     <button onClick={() => window.open('https://t.me/ApexMiner_Official', '_blank')} className="w-full bg-[#2AABEE] text-white font-bold py-3 rounded-xl flex items-center justify-center gap-2 shadow-lg active:scale-95 transition-transform">
                        <span>📢</span> Official Channel
                     </button>
                     <button onClick={() => window.open('https://t.me/ApexMinerGroup', '_blank')} className="w-full bg-[#229ED9] text-white font-bold py-3 rounded-xl flex items-center justify-center gap-2 shadow-lg active:scale-95 transition-transform">
                        <span>💬</span> Global Group
                     </button>
                     <button onClick={() => window.open('https://x.com/ApexNetworkApp', '_blank')} className="w-full bg-black border border-slate-700 text-white font-bold py-3 rounded-xl flex items-center justify-center gap-2 shadow-lg active:scale-95 transition-transform">
                        <svg viewBox="0 0 24 24" aria-hidden="true" className="w-4 h-4 fill-white"><g><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"></path></g></svg>
                        Official X (Twitter)
                     </button>
                   </div>

                   <h2 className="text-2xl font-bold text-white mb-4 border-b border-slate-800 pb-2">Official Links</h2>
                   <div className="flex flex-col gap-3 w-full mb-10">
                     <button onClick={() => window.open('https://apxn.network', '_blank')} className="w-full bg-slate-900 border border-yellow-500/30 text-white font-bold py-3 rounded-xl flex items-center justify-center gap-2 shadow-lg active:scale-95 transition-transform">
                        <span>🌐</span> apxn.network
                     </button>
                     <button onClick={handleCopyEmail} className="w-full bg-slate-900 border border-slate-700 text-white font-bold py-3 rounded-xl flex items-center justify-center gap-2 shadow-lg active:scale-95 transition-transform">
                        <span>📧</span> Support : contact@apxn.network
                     </button>
                   </div>

                   <div className="bg-gradient-to-br from-red-950/60 to-black p-5 rounded-2xl border border-red-900/50 shadow-[0_10px_30px_rgba(153,27,27,0.3)] mb-8 relative overflow-hidden">
                     <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-red-600 to-red-900"></div>
                     <div className="flex items-center gap-2 mb-3">
                       <span className="text-red-500 text-xl">⚠️</span>
                       <h3 className="text-red-500 font-black tracking-widest text-sm uppercase">Legal Disclaimer</h3>
                     </div>
                     <p className="text-gray-400 text-[11px] leading-relaxed mb-3 font-medium">
                       <strong className="text-gray-200">NOT FINANCIAL ADVICE:</strong> The information provided within the Apex Network application, whitepaper, and roadmap does not constitute investment, financial, or trading advice.
                     </p>
                     <p className="text-gray-500 text-[10px] leading-relaxed">
                       APXN reserves the full right to revise the roadmap, milestones and dates according to events, changing global financial market conditions and force majeure circumstances. Dates are targets, not guarantees.
                     </p>
                   </div>
                </div>
             </div>
          )}

          {discoverView === 'roadmap' && (
             <div className="px-6 pt-8 w-full">
                <h2 className="text-2xl font-black text-white mb-2 text-center uppercase tracking-widest">APXN Roadmap</h2>
                <p className="text-gray-400 text-xs text-center mb-8">Q4 2026 — Q2 2028</p>
                <div className="relative border-l-2 border-slate-700 ml-3 pl-6 space-y-10 pb-8">
                  <div className="relative">
                    <span className="absolute -left-[31px] top-1 w-4 h-4 bg-yellow-500 rounded-full ring-4 ring-slate-950"></span>
                    <h3 className="font-black text-yellow-400 text-lg mb-1">Q4 2026: Mining, Tasks & Referrals</h3>
                    <ul className="text-gray-400 text-xs leading-relaxed list-disc ml-4 space-y-1">
                      <li>APXN Points mining and daily participation</li>
                      <li>Referrals, social and daily tasks, upgrades and staking</li>
                      <li>Continued Telegram Mini App improvements</li>
                    </ul>
                  </div>
                  <div className="relative">
                    <span className="absolute -left-[31px] top-1 w-4 h-4 bg-blue-500 rounded-full ring-4 ring-slate-950"></span>
                    <h3 className="font-black text-blue-400 text-lg mb-1">Q1 2027: APXN Membership & Loyalty KYC</h3>
                    <ul className="text-gray-400 text-xs leading-relaxed list-disc ml-4 space-y-1">
                      <li>Launch APXN Membership & Loyalty KYC</li>
                      <li>Display 100 APXN in the accounts of 10,000 Badge holders who complete the APXN Membership & Loyalty KYC tasks</li>
                      <li>The first airdrop can be claimed in Q2 2027 according to the official claim rules</li>
                    </ul>
                  </div>
                  <div className="relative">
                    <span className="absolute -left-[31px] top-1 w-4 h-4 bg-purple-500 rounded-full ring-4 ring-slate-950"></span>
                    <h3 className="font-black text-purple-400 text-lg mb-1">Q2 2027: Development, Partnerships & Airdrops</h3>
                    <ul className="text-gray-400 text-xs leading-relaxed list-disc ml-4 space-y-1">
                      <li>Continue APXN development, partnerships and marketing</li>
                      <li>Launch the second airdrop using approximately 2,000,000 APXN from the partnerships, marketing, development and airdrop fund</li>
                      <li>Open claims for the first and second airdrops</li>
                    </ul>
                  </div>
                  <div className="relative">
                    <span className="absolute -left-[31px] top-1 w-4 h-4 bg-green-500 rounded-full ring-4 ring-slate-950"></span>
                    <h3 className="font-black text-green-400 text-lg mb-1">Q3 2027: APXN DEX & CEX Launchpad</h3>
                    <ul className="text-gray-400 text-xs leading-relaxed list-disc ml-4 space-y-1">
                      <li>Launch APXN DEX</li>
                      <li>Launch a Launchpad on centralized exchanges (CEX)</li>
                    </ul>
                  </div>
                  <div className="relative">
                    <span className="absolute -left-[31px] top-1 w-4 h-4 bg-orange-500 rounded-full ring-4 ring-slate-950"></span>
                    <h3 className="font-black text-orange-400 text-lg mb-1">Q4 2027: Testnet & Exchange Listings</h3>
                    <ul className="text-gray-400 text-xs leading-relaxed list-disc ml-4 space-y-1">
                      <li>Launch the APXN testnet</li>
                      <li>Target APXN listings on CEX and DEX platforms</li>
                    </ul>
                  </div>
                  <div className="relative">
                    <span className="absolute -left-[31px] top-1 w-4 h-4 bg-cyan-500 rounded-full ring-4 ring-slate-950"></span>
                    <h3 className="font-black text-cyan-400 text-lg mb-1">Q1 2028: Mainnet Preparation & New Products</h3>
                    <ul className="text-gray-400 text-xs leading-relaxed list-disc ml-4 space-y-1">
                      <li>Prepare the APXN mainnet</li>
                      <li>Launch new products within the APXN ecosystem</li>
                    </ul>
                  </div>
                  <div className="relative">
                    <span className="absolute -left-[31px] top-1 w-4 h-4 bg-emerald-500 rounded-full ring-4 ring-slate-950"></span>
                    <h3 className="font-black text-emerald-400 text-lg mb-1">Q2 2028: APXN Mainnet Launch</h3>
                    <ul className="text-gray-400 text-xs leading-relaxed list-disc ml-4 space-y-1">
                      <li>Launch the APXN mainnet</li>
                    </ul>
                  </div>
                </div>
                <div className="mt-10 mb-8">
                  <h3 className="text-center text-gray-400 font-black tracking-widest text-[10px] uppercase mb-6">Core Project Flow</h3>
                  <div className="flex flex-col gap-2 items-center">
                    <div className="bg-slate-900 border border-slate-700 text-gray-300 px-4 py-2 rounded-lg text-xs font-bold text-center">Mining, Tasks & Referrals (Q4 2026)</div>
                    <div className="h-4 w-[2px] bg-yellow-500"></div>
                    <div className="bg-slate-900 border border-slate-700 text-gray-300 px-4 py-2 rounded-lg text-xs font-bold text-center">APXN Membership & Loyalty KYC (Q1 2027)</div>
                    <div className="h-4 w-[2px] bg-yellow-500"></div>
                    <div className="bg-slate-900 border border-slate-700 text-gray-300 px-4 py-2 rounded-lg text-xs font-bold text-center">First & Second Airdrop Claims (Q2 2027)</div>
                    <div className="h-4 w-[2px] bg-yellow-500"></div>
                    <div className="bg-slate-900 border border-slate-700 text-gray-300 px-4 py-2 rounded-lg text-xs font-bold text-center">APXN DEX & CEX Launchpad (Q3 2027)</div>
                    <div className="h-4 w-[2px] bg-yellow-500"></div>
                    <div className="bg-slate-900 border border-slate-700 text-gray-300 px-4 py-2 rounded-lg text-xs font-bold text-center">APXN Testnet & CEX / DEX Listings (Q4 2027)</div>
                    <div className="h-4 w-[2px] bg-yellow-500"></div>
                    <div className="bg-slate-900 border border-slate-700 text-gray-300 px-4 py-2 rounded-lg text-xs font-bold text-center">Mainnet Preparation & Products (Q1 2028)</div>
                    <div className="h-4 w-[2px] bg-yellow-500"></div>
                    <div className="bg-gradient-to-r from-emerald-600 to-teal-600 border border-emerald-400 text-white px-4 py-2 rounded-lg text-xs font-bold text-center">APXN Mainnet (Q2 2028)</div>
                  </div>
                </div>
                <div className="bg-slate-900/80 border border-yellow-600/30 rounded-xl p-4 mb-8">
                  <h3 className="font-bold text-yellow-400 text-sm mb-2">Roadmap Amendment Notice</h3>
                  <p className="text-gray-400 text-[11px] leading-relaxed">APXN reserves the full right to revise the roadmap, milestones and dates according to events, changing global financial market conditions and force majeure circumstances. Dates are targets, not guarantees.</p>
                </div>
             </div>
          )}

          {discoverView === 'whitepaper' && (
             <div className="px-6 pt-6 w-full">
                <h1 className="text-2xl font-black text-transparent bg-clip-text bg-gradient-to-r from-yellow-400 to-orange-500 text-center uppercase tracking-widest mb-2">APXN Whitepaper</h1>
                <p className="text-gray-400 text-[11px] text-center mb-7">Overview • Tokenomics • Community Rewards</p>

                <h2 className="text-lg font-bold text-white border-b border-slate-700 pb-2 mb-4">Apex Network Ecosystem</h2>
                <div className="bg-slate-900/80 border border-slate-800 rounded-xl p-4 mb-7">
                  <p className="text-gray-300 text-xs leading-relaxed">APXN begins as a Telegram Mini App featuring APXN Points mining, daily tasks, referrals, boosts and staking. The roadmap extends toward APXN DEX, an APXN testnet and an APXN mainnet.</p>
                  <p className="text-gray-400 text-[11px] leading-relaxed mt-3">APXN Points are in-app participation points, distinct from transferable on-chain APXN tokens. Token allocation follows official eligibility rules.</p>
                </div>

                <h2 className="text-lg font-bold text-white border-b border-slate-700 pb-2 mb-4">APXN Membership & Loyalty KYC & Airdrops</h2>
                <div className="bg-slate-900/80 border border-blue-500/40 rounded-xl p-4 mb-7 space-y-3">
                  <p className="text-gray-300 text-xs leading-relaxed"><strong className="text-white">Q1 2027:</strong> Launch APXN Membership & Loyalty KYC. Display 100 APXN in the accounts of 10,000 Badge holders who complete the required APXN Membership & Loyalty KYC tasks.</p>
                  <p className="text-gray-300 text-xs leading-relaxed">The displayed first-airdrop reward is not an immediate on-chain transfer. Its claim is scheduled for Q2 2027.</p>
                  <p className="text-gray-300 text-xs leading-relaxed"><strong className="text-white">Q2 2027:</strong> Launch the second airdrop, allocating approximately <strong className="text-yellow-400">2,000,000 APXN</strong> from the partnerships, marketing, development and airdrop fund. Open claims for the first and second airdrops.</p>
                  <p className="text-gray-400 text-[11px] leading-relaxed">The 63,000,000 APXN community allocation spans seven levels based on verified APXN Points. Final distribution rules will be published officially.</p>
                </div>

                <h2 className="text-lg font-bold text-white border-b border-slate-700 pb-2 mb-4">Seven Levels & Community Distribution</h2>
                <div className="bg-slate-900/80 border border-yellow-600/40 rounded-xl p-4 mb-7 space-y-3">
                  <p className="text-gray-300 text-xs leading-relaxed"><strong className="text-white">63,000,000 APXN</strong> are allocated to the community across seven levels. Each level will have its own dedicated APXN allocation, and each user's level depends on verified APXN Points.</p>
                  <p className="text-gray-300 text-xs leading-relaxed">Within each level, tokens are distributed proportionally to each eligible user's verified APXN Points compared with the total verified APXN Points of eligible users in the same level. Users within the same level do not automatically receive equal amounts.</p>
                  <p className="text-gray-300 text-xs leading-relaxed">A user's level and APXN allocation will appear on the Dashboard only after successfully completing <strong className="text-white">all stages of APXN Membership & Loyalty KYC</strong>.</p>
                  <p className="text-gray-400 text-[11px] leading-relaxed">Final allocations for all seven levels will be determined and officially announced before the distribution and listing planned in this Whitepaper.</p>
                </div>

                <h2 className="text-lg font-bold text-white border-b border-slate-700 pb-2 mb-4">Early Access Badge Guidelines</h2>
                <div className="bg-slate-900/80 border border-blue-500/40 rounded-xl p-4 mb-7">
                  <p className="text-gray-300 text-xs leading-relaxed">APXN will publish special official instructions for the Badge, including eligibility, activity requirements, benefits and the conditions for keeping the Badge. The final rules will be announced through official APXN channels.</p>
                </div>

                <h2 className="text-lg font-bold text-white border-b border-slate-700 pb-2 mb-4">Tokenomics — 100 Million APXN</h2>
                <div className="bg-slate-900/80 border border-slate-800 rounded-xl p-4 mb-4">
                  <div className="flex justify-between gap-2 items-center mb-3"><span className="text-gray-400 text-xs">Total Supply</span><strong className="text-yellow-400 text-sm">100,000,000 APXN</strong></div>
                  <div className="flex h-4 overflow-hidden rounded-full w-full gap-[2px]">
                    <div className="h-full bg-blue-500" style={{ width: '63%' }}></div>
                    <div className="h-full bg-purple-500" style={{ width: '15%' }}></div>
                    <div className="h-full bg-amber-500" style={{ width: '15%' }}></div>
                    <div className="h-full bg-orange-500" style={{ width: '5%' }}></div>
                    <div className="h-full bg-pink-500" style={{ width: '2%' }}></div>
                  </div>
                </div>
                <div className="space-y-3 mb-8">
                  <div className="bg-slate-900/80 p-4 rounded-xl border border-slate-800">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <h3 className="text-white font-bold text-sm">Community</h3>
                      <span className="bg-blue-600 text-white px-2 py-1 rounded text-[10px] font-black">63%</span>
                    </div>
                    <p className="text-yellow-400 text-xs font-black mt-2">63,000,000 APXN</p>
                    <p className="text-gray-400 text-[11px] leading-relaxed mt-2">Community allocation across seven levels based on verified APXN Points and officially announced distribution conditions.</p>
                  </div>
                  <div className="bg-slate-900/80 p-4 rounded-xl border border-slate-800">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <h3 className="text-white font-bold text-sm">Listings & Exchanges</h3>
                      <span className="bg-purple-600 text-white px-2 py-1 rounded text-[10px] font-black">15%</span>
                    </div>
                    <p className="text-yellow-400 text-xs font-black mt-2">15,000,000 APXN</p>
                    <p className="text-gray-400 text-[11px] leading-relaxed mt-2">Reserved for exchange listings and platform requirements.</p>
                  </div>
                  <div className="bg-slate-900/80 p-4 rounded-xl border border-slate-800">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <h3 className="text-white font-bold text-sm">Partnerships, Marketing, Development & Airdrops</h3>
                      <span className="bg-amber-600 text-white px-2 py-1 rounded text-[10px] font-black">15%</span>
                    </div>
                    <p className="text-yellow-400 text-xs font-black mt-2">15,000,000 APXN</p>
                    <p className="text-gray-400 text-[11px] leading-relaxed mt-2">Includes approximately 2,000,000 APXN for the second airdrop. This is included in the 15 million allocation, not additional supply.</p>
                  </div>
                  <div className="bg-slate-900/80 p-4 rounded-xl border border-slate-800">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <h3 className="text-white font-bold text-sm">Project Team</h3>
                      <span className="bg-orange-600 text-white px-2 py-1 rounded text-[10px] font-black">5%</span>
                    </div>
                    <p className="text-yellow-400 text-xs font-black mt-2">5,000,000 APXN</p>
                    <p className="text-gray-400 text-[11px] leading-relaxed mt-2">Reserved for the APXN project team.</p>
                  </div>
                  <div className="bg-slate-900/80 p-4 rounded-xl border border-slate-800">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <h3 className="text-white font-bold text-sm">CEX Launchpad</h3>
                      <span className="bg-pink-600 text-white px-2 py-1 rounded text-[10px] font-black">2%</span>
                    </div>
                    <p className="text-yellow-400 text-xs font-black mt-2">2,000,000 APXN</p>
                    <p className="text-gray-400 text-[11px] leading-relaxed mt-2">A separate allocation for the planned CEX Launchpad in Q3 2027.</p>
                  </div>
                </div>

                <h2 className="text-lg font-bold text-white border-b border-slate-700 pb-2 mb-4">Launchpad, DEX & Mainnet</h2>
                <div className="bg-slate-900/80 border border-slate-800 rounded-xl p-4 mb-7">
                  <p className="text-gray-300 text-xs leading-relaxed">Q3 2027 targets APXN DEX and CEX Launchpad. Q4 2027 targets APXN testnet and CEX/DEX listings. Q1 2028 covers mainnet preparation and new products, followed by the planned APXN mainnet launch in Q2 2028.</p>
                  <p className="text-gray-400 text-[11px] leading-relaxed mt-3">Launchpad pricing, eligible exchanges and participation conditions will be announced when confirmed. No active token sale is implied.</p>
                </div>

                <h2 className="text-lg font-bold text-white border-b border-slate-700 pb-2 mb-4">Smart Contract & Transparency</h2>
                <div className="bg-slate-900/80 border border-emerald-500/40 rounded-xl p-4 mb-7">
                  <p className="text-gray-300 text-[11px] leading-relaxed mb-3">APXN's BSC BEP-20 contract details are available below. BscScan verification is not the same as an independent security audit.</p>
                  <div className="bg-black/50 p-2 rounded-lg border border-slate-700"><span className="block text-[9px] text-gray-500 uppercase mb-1">Contract Address (BSC BEP-20)</span><span className="block text-[11px] font-mono text-yellow-400 break-all">0x88074bA197BBB0a3AFF891E52d05764F98509956</span></div>
                  <a href="https://bscscan.com/token/0x88074bA197BBB0a3AFF891E52d05764F98509956#transactions" target="_blank" rel="noopener noreferrer" className="mt-3 w-full bg-emerald-600/20 border border-emerald-500/50 text-emerald-400 py-2 rounded-lg text-xs font-bold text-center flex items-center justify-center gap-2 hover:bg-emerald-600/40 transition-colors">🔍 View on BscScan</a>
                </div>

                <div className="bg-gradient-to-br from-red-950/40 to-black border border-red-900/40 rounded-xl p-4 mb-8">
                  <h3 className="font-bold text-red-400 text-sm mb-2">Important Notice</h3>
                  <p className="text-gray-400 text-[11px] leading-relaxed">This whitepaper is informational, not financial advice or a guarantee of returns, prices or listing. APXN reserves the full right to revise the roadmap, milestones and dates according to events, changing global financial market conditions and force majeure circumstances. Dates are targets, not guarantees.</p>
                </div>
             </div>
          )}
        </div>
      )}

      <div className="fixed bottom-0 left-0 w-full bg-slate-950/95 backdrop-blur-xl border-t border-slate-800 p-2 flex justify-between items-center z-50 px-2">
        <button onClick={() => setActiveTab('mine')} className={`flex flex-col items-center justify-center gap-1 flex-1 h-12 ${activeTab === 'mine' ? 'text-yellow-400 scale-110 transition-transform' : 'text-gray-500 hover:text-gray-300'}`}>
          <span className="text-xl leading-none">⛏️</span><span className="text-[10px] font-bold leading-none mt-1">Mine</span>
        </button>
        <button onClick={() => setActiveTab('tasks')} className={`flex flex-col items-center justify-center gap-1 flex-1 h-12 ${activeTab === 'tasks' ? 'text-yellow-400 scale-110 transition-transform' : 'text-gray-500 hover:text-gray-300'}`}>
          <span className="text-xl leading-none">📋</span><span className="text-[10px] font-bold leading-none mt-1">Earn</span>
        </button>
        <button onClick={() => setActiveTab('friends')} className={`flex flex-col items-center justify-center gap-1 flex-1 h-12 ${activeTab === 'friends' ? 'text-yellow-400 scale-110 transition-transform' : 'text-gray-500 hover:text-gray-300'}`}>
          <span className="text-xl leading-none">👥</span><span className="text-[10px] font-bold leading-none mt-1">Friends</span>
        </button>
        <button onClick={() => setActiveTab('boosts')} className={`flex flex-col items-center justify-center gap-1 flex-1 h-12 ${activeTab === 'boosts' ? 'text-yellow-400 scale-110 transition-transform' : 'text-gray-500 hover:text-gray-300'}`}>
          <span className="text-xl leading-none">🚀</span><span className="text-[10px] font-bold leading-none mt-1">Boosts</span>
        </button>
        <button onClick={() => setActiveTab('discover')} className={`flex flex-col items-center justify-center gap-1 flex-1 h-12 ${activeTab === 'discover' ? 'text-yellow-400 scale-110 transition-transform' : 'text-gray-500 hover:text-gray-300'}`}>
          <span className="text-xl leading-none">🌍</span><span className="text-[10px] font-bold leading-none mt-1">Discover</span>
        </button>
      </div>
    </main>
  );
}
















