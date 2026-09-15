"use client";
import { useState, useEffect } from 'react';
import Image from 'next/image';
import { TonConnectButton } from '@tonconnect/ui-react';

const CLAIM_COOLDOWN_SECONDS = 12 * 60 * 60;
const MINING_SESSION_DURATION_SECONDS = 24 * 60 * 60;
const AD_REWARD_COOLDOWN_SECONDS = 24 * 60 * 60;
const MINING_BOOST_DURATION_SECONDS = 24 * 60 * 60;
const USER_CACHE_VERSION = 1;
const USER_CACHE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

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

function getMiningSessionEndsAt(lastClaim) {
  if (!lastClaim) {
    return (
      Date.now() +
      MINING_SESSION_DURATION_SECONDS * 1000
    );
  }

  const lastClaimTime = new Date(lastClaim).getTime();

  if (!Number.isFinite(lastClaimTime)) {
    return null;
  }

  return (
    lastClaimTime +
    MINING_SESSION_DURATION_SECONDS * 1000
  );
}

function getRemainingMiningSession(lastClaim) {
  const endsAt =
    getMiningSessionEndsAt(lastClaim);

  if (!Number.isFinite(endsAt)) {
    return 0;
  }

  const remainingSeconds =
    (endsAt - Date.now()) / 1000;

  if (remainingSeconds <= 0) {
    return 0;
  }

  return Math.ceil(remainingSeconds);
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

function calculateEstimatedMiningDelta({
  lastClaim,
  baseRate,
  activeFriends,
  boostStartedAt,
  boostUntil,
}) {
  if (!lastClaim) return 0;

  const lastClaimTime = new Date(lastClaim).getTime();
  const nowTime = Date.now();

  if (!Number.isFinite(lastClaimTime)) return 0;

  const accrualEndTime = Math.min(
    nowTime,
    lastClaimTime +
      MINING_SESSION_DURATION_SECONDS * 1000
  );

  const elapsedSeconds = Math.max(
    0,
    (accrualEndTime - lastClaimTime) / 1000
  );

  const normalRate = getEffectiveMiningRate(
    baseRate,
    activeFriends,
    false
  );

  const boostedRate = getEffectiveMiningRate(
    baseRate,
    activeFriends,
    true
  );

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
    const overlapStart = Math.max(
      lastClaimTime,
      boostStartTime
    );

    const overlapEnd = Math.min(
      accrualEndTime,
      boostUntilTime
    );

    boostedSeconds = Math.max(
      0,
      (overlapEnd - overlapStart) / 1000
    );
  }

  boostedSeconds = Math.min(
    elapsedSeconds,
    boostedSeconds
  );

  const normalSeconds = Math.max(
    0,
    elapsedSeconds - boostedSeconds
  );

  return (
    normalSeconds * normalRate +
    boostedSeconds * boostedRate
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
  const [claimCooldown, setClaimCooldown] = useState(0);
  const [miningSessionRemaining, setMiningSessionRemaining] =
    useState(MINING_SESSION_DURATION_SECONDS);
  const [miningSessionEndsAt, setMiningSessionEndsAt] =
    useState(null);
  const [isWatchingClaimAd, setIsWatchingClaimAd] = useState(false);
  const [activeTab, setActiveTab] = useState('mine');

  const [discoverView, setDiscoverView] = useState('about');

  const [taskCompleted, setTaskCompleted] = useState(false);
  const [groupTaskCompleted, setGroupTaskCompleted] = useState(false);
  const [twitterTaskCompleted, setTwitterTaskCompleted] = useState(false);

  const dailyTwitterLink = process.env.NEXT_PUBLIC_DAILY_TWITTER_LINK || '';
  const dailyTelegramLink = process.env.NEXT_PUBLIC_DAILY_TELEGRAM_LINK || '';

  const [dailyTwitterDone, setDailyTwitterDone] = useState(false);
  const [dailyTelegramDone, setDailyTelegramDone] = useState(false);
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

  const [miningBoostRemaining, setMiningBoostRemaining] = useState(0);
  const [isWatchingBoostAd, setIsWatchingBoostAd] = useState(false);
  const [isMiningBoostStatusLoaded, setIsMiningBoostStatusLoaded] = useState(false);

  const [checkinStreak, setCheckinStreak] = useState(0);
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

  const [showWalletModal, setShowWalletModal] = useState(false);
  const [walletAddress, setWalletAddress] = useState(null);
  const [isConnecting, setIsConnecting] = useState(false);
  const [selectedWallet, setSelectedWallet] = useState('');

  const [manualWalletInput, setManualWalletInput] = useState(false);
  const [tempAddress, setTempAddress] = useState('');

  const isMiningBoostActive =
    miningBoostRemaining > 0;

  const isMiningPaused =
    isDataLoaded &&
    miningSessionRemaining <= 0;

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

  const handleConnectWallet = async (walletName) => {
    setSelectedWallet(walletName);
    setIsConnecting(true);

    try {
      let provider = null;
      if (typeof window !== 'undefined') {
        if (walletName === 'MetaMask' && window.ethereum) {
          provider = window.ethereum;
        } else if (walletName === 'Trust Wallet' && window.trustwallet) {
          provider = window.trustwallet;
        } else if (walletName === 'OKX Web3' && window.okxwallet) {
          provider = window.okxwallet;
        } else if (walletName === 'Binance Web3' && window.BinanceChain) {
          provider = window.BinanceChain;
        } else if (window.ethereum) {
          provider = window.ethereum;
        }
      }
      if (!provider) {
        setManualWalletInput(true);
        setIsConnecting(false);
        return;
      }
      const accounts = await provider.request({ method: 'eth_requestAccounts' });

      if (accounts && accounts.length > 0) {
        const address = accounts[0];
        setWalletAddress(`0x${address.substring(2, 6)}...${address.substring(address.length - 4)}`);
        setShowWalletModal(false);
      }
    } catch (error) {
      console.error("Connection error:", error);
      alert("❌ Connection cancelled or failed.");
    } finally {
      setIsConnecting(false);
    }
  };

  const handleManualBind = () => {
    if (tempAddress.length === 42 && tempAddress.startsWith('0x')) {
      setWalletAddress(`${tempAddress.substring(0, 6)}...${tempAddress.substring(tempAddress.length - 4)}`);
      setShowWalletModal(false);
      setManualWalletInput(false);
      setTempAddress('');
      alert("✅ Wallet Successfully Linked for TGE!");
    } else {
      alert("❌ Please enter a valid BSC (BEP-20) address starting with '0x'!");
    }
  };

  const closeModal = () => {
    setShowWalletModal(false);
    setManualWalletInput(false);
    setTempAddress('');
  };

  useEffect(() => {
    let attempts = 0;
    let timer = null;
    let cancelled = false;

    const applyUserState = ({
      verifiedUserId,
      verifiedFirstName,
      verifiedUsername,
      userData,
      fromCache = false,
    }) => {
      if (cancelled) return;

      const currentDbRate = Number(userData.miningRate ?? 0.00025);
      const cachedActiveFriends = Number(userData.activeFriendsCount ?? 0);
      const cachedFriendsCount = Number(userData.friendsCount ?? 0);
      const currentMiningBoostStartedAt =
        userData.miningBoostStartedAt || null;

      const currentMiningBoostUntil =
        userData.miningBoostUntil || null;

      const currentMiningBoostRemaining =
        getRemainingMiningBoost(
          currentMiningBoostUntil
        );

      const cachedTotalRate =
        getEffectiveMiningRate(
          currentDbRate,
          cachedActiveFriends,
          currentMiningBoostRemaining > 0
        );

      setUserId(verifiedUserId);
      setFirstName(verifiedFirstName);
      setUserName(verifiedUsername);

      setBalance(Number(userData.balance || 0));
      setDbMiningRate(currentDbRate);
      setTotalMiningRate(cachedTotalRate);

      setFriendsCount(cachedFriendsCount);
      setActiveFriendsCount(cachedActiveFriends);
      setFriendsLoaded(false);

      setTaskCompleted(Boolean(userData.channelJoined));
      setGroupTaskCompleted(Boolean(userData.groupJoined));
      setTwitterTaskCompleted(Boolean(userData.twitterJoined));

      const todayStr = new Date().toISOString().split('T')[0];

      setDailyTwitterDone(userData.lastTwitterTask === todayStr);
      setDailyTelegramDone(userData.lastTelegramTask === todayStr);

      setAdRewardCooldown(
        getRemainingAdRewardCooldown(
          userData.lastAdRewardAt
        )
      );

      setIsAdRewardStatusLoaded(
        !fromCache
      );

      setMiningBoostRemaining(
        currentMiningBoostRemaining
      );

      setIsMiningBoostStatusLoaded(
        !fromCache
      );

      let currentStreak = Number(userData.checkinStreak || 0);
      let isCheckinAvailable = true;
      const now = new Date();

      if (userData.lastCheckinDate) {
        const lastDate = new Date(userData.lastCheckinDate);

        if (lastDate.toISOString().split('T')[0] === todayStr) {
          isCheckinAvailable = false;
        } else {
          const yesterday = new Date(now);
          yesterday.setUTCDate(yesterday.getUTCDate() - 1);

          if (
            lastDate.toISOString().split('T')[0] !==
            yesterday.toISOString().split('T')[0]
          ) {
            currentStreak = 0;
          }
        }
      }

      setCheckinStreak(currentStreak);
      setCanCheckIn(isCheckinAvailable);
      setDailyRewardAmt(((currentStreak % 7) + 1) * 100);

      if (userData.lastClaim) {
        const lastTime = new Date(userData.lastClaim).getTime();
        const diffSeconds = Math.max(0, (Date.now() - lastTime) / 1000);

        setMiningSessionRemaining(
          getRemainingMiningSession(
            userData.lastClaim
          )
        );
        setMiningSessionEndsAt(
          getMiningSessionEndsAt(
            userData.lastClaim
          )
        );

        if (diffSeconds > 0) {
          setMiningDelta(
            calculateEstimatedMiningDelta({
              lastClaim: userData.lastClaim,
              baseRate: currentDbRate,
              activeFriends: cachedActiveFriends,
              boostStartedAt:
                currentMiningBoostStartedAt,
              boostUntil:
                currentMiningBoostUntil,
            })
          );
        }

        if (diffSeconds < CLAIM_COOLDOWN_SECONDS) {
          setClaimCooldown(
            Math.floor(CLAIM_COOLDOWN_SECONDS - diffSeconds)
          );
        } else {
          setClaimCooldown(0);
        }
      } else {
        setMiningDelta(0);
        setClaimCooldown(0);
        setMiningSessionRemaining(
          MINING_SESSION_DURATION_SECONDS
        );
        setMiningSessionEndsAt(
          Date.now() +
            MINING_SESSION_DURATION_SECONDS * 1000
        );
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
          checkinStreak: Number(userData.checkinStreak || 0),
          lastCheckinDate: userData.lastCheckinDate || null,
          lastClaim: userData.lastClaim || null,
          lastAdRewardAt: userData.lastAdRewardAt || null,
          adRewardCount: Number(userData.adRewardCount || 0),
          miningBoostStartedAt:
            currentMiningBoostStartedAt,
          miningBoostUntil:
            currentMiningBoostUntil,
          miningBoostCount:
            Number(userData.miningBoostCount || 0),
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

        const authData = await authResponse.json();

        if (cancelled) return;

        const verifiedUserId = String(authData.user.id);
        const verifiedFirstName =
          authData.user.firstName || 'Unknown';
        const verifiedUsername =
          authData.user.username || 'No Username';

        setUserId(verifiedUserId);
        setFirstName(verifiedFirstName);
        setUserName(verifiedUsername);

        // Existing users load instantly from local cache, then the
        // authoritative balance is synchronized from Supabase.
        const cachedUser = readUserCache(verifiedUserId);

        if (cachedUser) {
          // Fast first render from local cache.
          applyUserState({
            verifiedUserId,
            verifiedFirstName,
            verifiedUsername,
            userData: cachedUser,
            fromCache: true,
          });

          // Silent balance synchronization.
          //
          // This keeps the app fast while ensuring rewards or manual
          // balance changes made in Supabase appear when the app opens,
          // without waiting for the user to press Claim.
          try {
            const bootstrapResponse = await fetch('/api/bootstrap', {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
              },
              body: JSON.stringify({ initData }),
              cache: 'no-store',
            });

            if (bootstrapResponse.ok) {
              const data = await bootstrapResponse.json();
              const freshBalance = Number(data?.user?.balance);

              if (
                !cancelled &&
                data?.exists &&
                data?.user
              ) {
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

                const freshMiningBoostRemaining =
                  getRemainingMiningBoost(
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

                const freshTotalMiningRate =
                  getEffectiveMiningRate(
                    freshDbRate,
                    cachedActiveFriends,
                    freshMiningBoostRemaining > 0
                  );

                const freshLastClaim =
                  data.user.lastClaim ||
                  cachedUser.lastClaim ||
                  null;

                if (freshLastClaim) {
                  setMiningSessionRemaining(
                    getRemainingMiningSession(
                      freshLastClaim
                    )
                  );
                  setMiningSessionEndsAt(
                    getMiningSessionEndsAt(
                      freshLastClaim
                    )
                  );

                  setMiningDelta(
                    calculateEstimatedMiningDelta({
                      lastClaim: freshLastClaim,
                      baseRate: freshDbRate,
                      activeFriends:
                        cachedActiveFriends,
                      boostStartedAt:
                        freshMiningBoostStartedAt,
                      boostUntil:
                        freshMiningBoostUntil,
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
                        (Date.now() -
                          freshLastClaimTime) /
                          1000
                      );

                    setClaimCooldown(
                      elapsedSeconds <
                        CLAIM_COOLDOWN_SECONDS
                        ? Math.floor(
                            CLAIM_COOLDOWN_SECONDS -
                              elapsedSeconds
                          )
                        : 0
                    );
                  }
                } else {
                  setMiningDelta(0);
                  setClaimCooldown(0);
                  setMiningSessionRemaining(
                    MINING_SESSION_DURATION_SECONDS
                  );
                  setMiningSessionEndsAt(
                    Date.now() +
                      MINING_SESSION_DURATION_SECONDS * 1000
                  );
                }

                setDbMiningRate(
                  freshDbRate
                );

                setTotalMiningRate(
                  freshTotalMiningRate
                );

                setMiningBoostRemaining(
                  freshMiningBoostRemaining
                );

                setIsMiningBoostStatusLoaded(
                  true
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
                });
              }
            }
          } catch {
            // If synchronization temporarily fails, keep showing
            // the cached balance and try again on the next app open.
          }

          return;
        }

        // Cache miss/new device: only then read the user from Supabase.
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

        const data = await bootstrapResponse.json();

        if (cancelled) return;

        if (data.exists && data.user) {
          applyUserState({
            verifiedUserId,
            verifiedFirstName,
            verifiedUsername,
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
          userData: {
            balance: Number(registeredUser.balance || 0),
            miningRate: Number(
              registeredUser.miningRate || 0.00025
            ),
            totalMiningRate: Number(
              registeredUser.miningRate || 0.00025
            ),
            friendsCount: 0,
            activeFriendsCount: 0,
            channelJoined: false,
            groupJoined: false,
            twitterJoined: false,
            lastTwitterTask: null,
            lastTelegramTask: null,
            checkinStreak: 0,
            lastCheckinDate: null,
            lastClaim:
              registeredUser.lastClaim ||
              new Date().toISOString(),
            lastAdRewardAt: null,
            adRewardCount: 0,
            miningBoostStartedAt: null,
            miningBoostUntil: null,
            miningBoostCount: 0,
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
            dbMiningRate,
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
              lastClaim: cachedLastClaim,
              baseRate: dbMiningRate,
              activeFriends: activeCount,
              boostStartedAt:
                cachedUser?.miningBoostStartedAt || null,
              boostUntil:
                cachedUser?.miningBoostUntil || null,
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
    isMiningBoostActive,
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
            dbMiningRate,
            activeCount,
            miningBoostRemaining > 0
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
    dbMiningRate,
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

      setClaimCooldown(prev => (prev > 0 ? prev - 1 : 0));
      setAdRewardCooldown(prev => (prev > 0 ? prev - 1 : 0));
      setMiningBoostRemaining(prev => (prev > 0 ? prev - 1 : 0));
    }, 1000);

    return () => clearInterval(interval);
  }, [
    totalMiningRate,
    miningSessionEndsAt,
  ]);

  useEffect(() => {
    setTotalMiningRate(
      getEffectiveMiningRate(
        dbMiningRate,
        activeFriendsCount,
        isMiningBoostActive
      )
    );
  }, [
    dbMiningRate,
    activeFriendsCount,
    isMiningBoostActive,
  ]);

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
        body: JSON.stringify({ initData }),
        cache: 'no-store',
      });

      const data = await response.json();

      if (!response.ok) {
        if (response.status === 409) {
          const syncedBalance = Number(data.balance);
          const syncedStreak = Number(data.checkinStreak);

          if (Number.isFinite(syncedBalance)) {
            setBalance(syncedBalance);
          }

          if (Number.isFinite(syncedStreak)) {
            setCheckinStreak(syncedStreak);
            setDailyRewardAmt(
              ((syncedStreak % 7) + 1) * 100
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
            lastCheckinDate: new Date().toISOString(),
          });

          return;
        }

        throw new Error(data.error || 'Check-in failed');
      }

      const newBalance = Number(data.balance || 0);
      const newStreak = Number(data.checkinStreak || 0);
      const lastCheckinDate =
        data.lastCheckinDate || new Date().toISOString();

      setBalance(newBalance);
      setCheckinStreak(newStreak);
      setCanCheckIn(false);
      setDailyRewardAmt(
        ((newStreak % 7) + 1) * 100
      );

      patchUserCache(userId, {
        balance: newBalance,
        checkinStreak: newStreak,
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
    if (
      !isDataLoaded ||
      isSaving ||
      isWatchingClaimAd ||
      isWatchingAd ||
      isWatchingBoostAd ||
      claimCooldown > 0 ||
      miningDelta < 0.0001
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

    let adCompleted = false;

    setIsWatchingClaimAd(true);

    try {
      // The Claim request is sent only after the existing
      // Monetag rewarded interstitial promise completes.
      await window.show_11803132();
      adCompleted = true;

      setIsSaving(true);

      const response = await fetch('/api/mining/claim', {
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
          (response.status === 429 || response.status === 409) &&
          data.retryAfter
        ) {
          setClaimCooldown(Number(data.retryAfter));
        }

        throw new Error(data.error || 'Claim failed');
      }

      const newLastClaim =
        data.lastClaim ||
        new Date().toISOString();

      setBalance(Number(data.balance || 0));
      setMiningDelta(0);
      setClaimCooldown(
        Number(data.cooldown || CLAIM_COOLDOWN_SECONDS)
      );
      setMiningSessionRemaining(
        MINING_SESSION_DURATION_SECONDS
      );
      setMiningSessionEndsAt(
        getMiningSessionEndsAt(
          newLastClaim
        )
      );

      if (Number.isFinite(Number(data.baseMiningRate))) {
        setDbMiningRate(Number(data.baseMiningRate));
      }

      if (Number.isFinite(Number(data.miningRate))) {
        setTotalMiningRate(Number(data.miningRate));
      }

      if (Number.isFinite(Number(data.activeFriends))) {
        setActiveFriendsCount(Number(data.activeFriends));
      }

      patchUserCache(userId, {
        balance: Number(data.balance || 0),
        miningRate: Number(data.baseMiningRate || dbMiningRate),
        totalMiningRate: Number(data.miningRate || totalMiningRate),
        activeFriendsCount: Number(data.activeFriends || 0),
        lastClaim: newLastClaim,
      });
    } catch (error) {
      console.error('Claim failed:', error);

      if (!adCompleted) {
        alert(
          '❌ Ad was not completed. Your points were not claimed.'
        );
      } else if (
        error?.message &&
        error.message !== 'Claim cooldown active'
      ) {
        alert('❌ Claim failed. Please try again.');
      }
    } finally {
      setIsSaving(false);
      setIsWatchingClaimAd(false);
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
    cacheField,
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

          setCompleted(true);
          updateTaskConfirmStage(
            confirmationKey,
            0
          );

          patchUserCache(userId, {
            ...(Number.isFinite(syncedBalance)
              ? { balance: syncedBalance }
              : {}),
            [cacheField]: taskDate,
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

      setBalance(newBalance);
      setCompleted(true);
      updateTaskConfirmStage(
        confirmationKey,
        0
      );

      patchUserCache(userId, {
        balance: newBalance,
        [cacheField]: taskDate,
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
          cacheField: 'lastTwitterTask',
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
          cacheField: 'lastTelegramTask',
          confirmationKey: 'dailyTelegram',
        });
      },
    });
  };

  const handleWatchAdReward = async () => {
    if (
      !isDataLoaded ||
      !isAdRewardStatusLoaded ||
      isWatchingAd ||
      isWatchingBoostAd ||
      isWatchingClaimAd ||
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
      isWatchingBoostAd ||
      isWatchingAd ||
      isWatchingClaimAd ||
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
                getRemainingMiningBoost(
                  boostUntil
                ) ||
                MINING_BOOST_DURATION_SECONDS
              )
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
        getRemainingMiningBoost(
          boostUntil
        ) ||
        MINING_BOOST_DURATION_SECONDS;

      const boostedMiningRate =
        getEffectiveMiningRate(
          dbMiningRate,
          activeFriendsCount,
          true
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
      {showWalletModal && (
        <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
           <div className="bg-slate-900 border border-yellow-500/50 rounded-2xl w-full max-w-sm p-6 relative shadow-[0_0_30px_rgba(234,179,8,0.2)]">
              <button onClick={closeModal} className="absolute top-4 right-4 text-gray-400 hover:text-white text-xl">✖</button>

              {!manualWalletInput ? (
                <>
                  <h3 className="text-xl font-black text-white mb-6 text-center flex items-center justify-center gap-2">
                     <img src="/binance-logo-1.png" alt="Binance" className="w-6 h-6 object-contain" /> Connect BSC Wallet
                  </h3>
                  <div className="flex flex-col gap-3">
                     <button onClick={() => handleConnectWallet('Binance Web3')} disabled={isConnecting} className={`w-full flex items-center gap-3 bg-slate-800 p-4 rounded-xl border ${isConnecting && selectedWallet === 'Binance Web3' ? 'border-yellow-400 bg-slate-800/80' : 'border-slate-700 hover:border-yellow-400'} transition-all`}>
                        <img src="/binance-logo-1.png" alt="Binance" className="w-7 h-7 object-contain drop-shadow-md" />
                        <span className="text-white font-bold text-lg">{isConnecting && selectedWallet === 'Binance Web3' ? 'Connecting...' : 'Binance Web3'}</span>
                     </button>
                     <button onClick={() => handleConnectWallet('MetaMask')} disabled={isConnecting} className={`w-full flex items-center gap-3 bg-slate-800 p-4 rounded-xl border ${isConnecting && selectedWallet === 'MetaMask' ? 'border-orange-500 bg-slate-800/80' : 'border-slate-700 hover:border-orange-500'} transition-all`}>
                        <span className="text-2xl w-7 text-center">🦊</span>
                        <span className="text-white font-bold text-lg">{isConnecting && selectedWallet === 'MetaMask' ? 'Connecting...' : 'MetaMask'}</span>
                     </button>
                     <button onClick={() => handleConnectWallet('Trust Wallet')} disabled={isConnecting} className={`w-full flex items-center gap-3 bg-slate-800 p-4 rounded-xl border ${isConnecting && selectedWallet === 'Trust Wallet' ? 'border-blue-500 bg-slate-800/80' : 'border-slate-700 hover:border-blue-500'} transition-all`}>
                        <span className="text-2xl w-7 text-center">🛡️</span>
                        <span className="text-white font-bold text-lg">{isConnecting && selectedWallet === 'Trust Wallet' ? 'Connecting...' : 'Trust Wallet'}</span>
                     </button>
                     <button onClick={() => handleConnectWallet('OKX Web3')} disabled={isConnecting} className={`w-full flex items-center gap-3 bg-slate-800 p-4 rounded-xl border ${isConnecting && selectedWallet === 'OKX Web3' ? 'border-white bg-slate-800/80' : 'border-slate-700 hover:border-white'} transition-all`}>
                        <span className="text-xl font-black text-white w-7 text-center">OKX</span>
                        <span className="text-white font-bold text-lg">{isConnecting && selectedWallet === 'OKX Web3' ? 'Connecting...' : 'OKX Web3'}</span>
                     </button>
                  </div>
                </>
              ) : (
                <div className="flex flex-col items-center animate-in fade-in duration-300">
                   <div className="w-16 h-16 bg-yellow-500/20 rounded-full flex items-center justify-center mb-4 border border-yellow-500/50">
                     <span className="text-2xl">🔗</span>
                   </div>
                   <h3 className="text-lg font-black text-white mb-2 text-center">Link Wallet Address</h3>
                   <p className="text-xs text-gray-400 text-center mb-6 leading-relaxed">
                     Telegram browser does not support direct connections. Please paste your <strong className="text-yellow-400">BSC (BEP-20)</strong> address below to link it to your account for future Airdrops.
                   </p>

                   <div className="w-full mb-4">
                     <label className="text-[10px] text-gray-500 uppercase tracking-widest font-bold mb-1 block">Your BEP-20 Address</label>
                     <input
                       type="text"
                       value={tempAddress}
                       onChange={(e) => setTempAddress(e.target.value)}
                       placeholder="0x..."
                       className="w-full bg-slate-950 border border-slate-700 rounded-xl p-3 text-white text-sm outline-none focus:border-yellow-500 focus:ring-1 focus:ring-yellow-500 transition-all font-mono"
                     />
                   </div>

                   <button onClick={handleManualBind} className="w-full py-3 bg-gradient-to-r from-yellow-500 to-orange-500 text-white font-bold rounded-xl shadow-[0_0_15px_rgba(245,158,11,0.4)] active:scale-95 transition-all">
                     Bind Address
                   </button>

                   <button onClick={() => setManualWalletInput(false)} className="w-full mt-3 py-2 text-gray-500 text-xs font-bold hover:text-white transition-colors">
                     Cancel
                   </button>
                </div>
              )}
              {!manualWalletInput && <p className="text-[10px] font-bold text-yellow-500 text-center mt-6 uppercase tracking-wider">Supports Binance Smart Chain (BEP-20)</p>}
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

          <button onClick={() => setShowWalletModal(true)} className={`border font-bold px-4 py-2 rounded-xl text-xs transition-colors flex items-center gap-2 ${walletAddress ? 'bg-yellow-500/10 border-yellow-500/50 text-yellow-500' : 'bg-slate-800 border-slate-700 text-white hover:border-yellow-500'}`}>
            {walletAddress ? (
               <span>✅</span>
            ) : (
               <img src="/binance-logo-1.png" alt="Binance" className="w-4 h-4 object-contain" />
            )}
            <span>{walletAddress ? walletAddress : 'Connect Wallet'}</span>
          </button>
        </div>

        <div className="w-full flex justify-end items-center gap-2 mt-2">
          <div className="origin-right scale-[0.85]">
            <TonConnectButton />
          </div>
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
               </div>
               <span className="font-semibold text-yellow-400 text-xs">+{totalMiningRate.toFixed(5)} APXN/sec</span>
            </div>

            <div className={`rounded-2xl p-4 flex items-center justify-between border ${
              isMiningBoostActive
                ? 'bg-fuchsia-950/30 border-fuchsia-500/50 shadow-[0_0_18px_rgba(217,70,239,0.12)]'
                : 'bg-slate-900/60 border-slate-800'
            }`}>
              <div className="flex flex-col pr-3">
                <span className="text-white text-sm font-black">⚡ x3 Mining Boost</span>
                <span className="text-[10px] text-gray-400 mt-1">
                  {isMiningBoostActive
                    ? `Active • ${formatTime(miningBoostRemaining)} left`
                    : 'Watch an ad → x3 base mining speed for 24h'}
                </span>
              </div>

              <button
                onClick={handleWatchMiningBoost}
                disabled={
                  !isDataLoaded ||
                  !isMiningBoostStatusLoaded ||
                  isWatchingBoostAd ||
                  isWatchingAd ||
                  isWatchingClaimAd ||
                  isMiningBoostActive
                }
                className={`px-4 py-2 rounded-xl text-xs font-black min-w-[84px] transition-all ${
                  isMiningBoostActive
                    ? 'bg-fuchsia-600/30 text-fuchsia-300 border border-fuchsia-500/40 cursor-not-allowed'
                    : (!isDataLoaded || !isMiningBoostStatusLoaded || isWatchingBoostAd || isWatchingAd || isWatchingClaimAd)
                    ? 'bg-slate-700 text-gray-300 animate-pulse'
                    : 'bg-gradient-to-r from-fuchsia-600 to-purple-600 text-white active:scale-95'
                }`}
              >
                {!isDataLoaded || !isMiningBoostStatusLoaded
                  ? 'Wait..'
                  : isWatchingBoostAd
                  ? 'Ad...'
                  : isWatchingAd || isWatchingClaimAd
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
               isMiningPaused
                 ? 'text-red-400'
                 : 'text-emerald-400'
             }`}>
               {isMiningPaused
                 ? '⏸ Mining Paused • Claim points to restart'
                 : `● Mining Active • ${formatTime(miningSessionRemaining)} left`}
             </div>
          </div>

          <div className="flex-1 flex items-center justify-center my-8 relative w-full">
            <div className="absolute inset-0 bg-yellow-500 blur-[80px] opacity-20 rounded-full"></div>

            <div className="w-56 h-56 rounded-full p-[4px] bg-gradient-to-b from-yellow-300 via-yellow-500 to-yellow-800 shadow-[0_0_50px_rgba(234,179,8,0.4),inset_0_0_20px_rgba(255,255,255,0.5)] z-10 flex items-center justify-center relative">
              <div className="w-full h-full rounded-full border-[6px] border-slate-950 overflow-hidden shadow-[inset_0_0_30px_rgba(0,0,0,0.8)] relative">
                 <Image src="/logo2.png" alt="Apex Coin" width={200} height={200} className="w-full h-full object-cover rounded-full drop-shadow-[0_0_15px_rgba(255,255,255,0.2)]" />
                 <div className="absolute inset-0 bg-gradient-to-tr from-transparent via-white/10 to-transparent rounded-full pointer-events-none"></div>
              </div>
            </div>

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
              isWatchingClaimAd ||
              isWatchingAd ||
              isWatchingBoostAd ||
              claimCooldown > 0
            }
            className={`w-full py-4 mt-auto mb-4 rounded-2xl text-lg font-bold shadow-[0_4px_20px_rgba(245,158,11,0.4)] transition-all ${
              !isDataLoaded
                ? 'bg-slate-800 text-gray-500 cursor-wait'
                : claimCooldown > 0
                ? 'bg-slate-800 border border-slate-700 text-gray-400 cursor-not-allowed shadow-none'
                : (isSaving || isWatchingClaimAd || isWatchingAd || isWatchingBoostAd)
                ? 'bg-slate-700 text-gray-300 animate-pulse'
                : 'bg-gradient-to-r from-yellow-500 to-orange-600 text-white active:scale-95'
            }`}
          >
            {!isDataLoaded
              ? 'LOADING...'
              : claimCooldown > 0
                ? `WAIT ${formatTime(claimCooldown)}`
                : isWatchingClaimAd
                  ? 'WATCHING AD...'
                  : isSaving
                    ? 'CLAIMING...'
                    : (isWatchingAd || isWatchingBoostAd)
                      ? 'WAIT...'
                      : isMiningPaused
                        ? 'WATCH AD & CLAIM • RESTART MINING'
                        : 'WATCH AD & CLAIM POINTS'
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
                Log in daily to increase your reward.<br/> <span className="font-bold text-white">Missing a day resets your streak to 0!</span>
              </p>
              <div className="flex items-center justify-center gap-3 mb-4 w-full">
                 <div className="flex-1 bg-black/20 rounded-xl px-2 py-3 text-center backdrop-blur-sm border border-white/10">
                    <span className="block text-[9px] text-yellow-200 uppercase tracking-widest mb-1">Current Streak</span>
                    <span className="text-2xl font-black text-white">{checkinStreak} <span className="text-sm">Days</span>🔥</span>
                 </div>
                 <div className="flex-1 bg-black/20 rounded-xl px-2 py-3 text-center backdrop-blur-sm border border-white/10">
                    <span className="block text-[9px] text-yellow-200 uppercase tracking-widest mb-1">
                      {canCheckIn ? "Today's Reward" : "Tomorrow's Reward"}
                    </span>
                    <span className="text-2xl font-black text-yellow-400">+{dailyRewardAmt}</span>
                 </div>
              </div>
              <button onClick={handleDailyCheckIn} disabled={!isDataLoaded || !canCheckIn || isSaving} className={`w-full py-3 rounded-xl text-base font-black uppercase tracking-wider transition-all shadow-lg ${(isDataLoaded && canCheckIn) ? 'bg-white text-orange-600 hover:scale-105 active:scale-95' : 'bg-black/30 text-white/50 cursor-not-allowed border border-white/10'}`}>
                {!isDataLoaded ? 'Loading...' : (isSaving ? 'Claiming...' : (canCheckIn ? 'Claim Reward' : 'Come Back Tomorrow'))}
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
                  isWatchingClaimAd ||
                  adRewardCooldown > 0
                }
                className={`px-4 py-2 rounded-xl text-white text-sm font-bold transition-colors min-w-[80px] ${
                  adRewardCooldown > 0
                    ? 'bg-green-600'
                    : (!isDataLoaded || !isAdRewardStatusLoaded || isWatchingAd || isWatchingBoostAd || isWatchingClaimAd)
                    ? 'bg-slate-700 animate-pulse'
                    : 'bg-gradient-to-r from-yellow-500 to-orange-600 active:scale-95'
                }`}
              >
                {!isDataLoaded || !isAdRewardStatusLoaded
                  ? 'Wait..'
                  : isWatchingAd
                  ? 'Ad...'
                  : isWatchingBoostAd || isWatchingClaimAd
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
                  Mandatory KYC Requirement
                </h3>
                <p className="text-gray-300 text-[11px] leading-relaxed">
                  To protect our ecosystem from fraud and prove you are a human entitled to an account, based on our Whitepaper, you must unlock at least <strong className="text-white bg-red-500/20 px-1 rounded">2 stages in EVERY level</strong>. This is a strict condition to pass <strong className="text-red-400">KYC</strong> verification and qualify for the <span className="text-white font-bold">$APXN Airdrop</span> withdrawal.
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
              title: "Level 3: TON Elite",
              currency: "💎 TON",
              items: [
                { name: "Apex Quantum", price: "0.1", boost: "+0.03/sec" },
                { name: "Titan Node", price: "0.2", boost: "+0.04/sec" },
                { name: "Cyber Miner", price: "0.3", boost: "+0.05/sec" },
                { name: "Genesis Rig", price: "0.4", boost: "+0.06/sec" }
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
             <button onClick={() => setDiscoverView('whitepaper')} className={`py-2 px-4 rounded-lg text-xs font-bold transition-colors ${discoverView === 'whitepaper' ? 'bg-yellow-600 text-slate-900' : 'text-gray-400 hover:text-white'}`}>Tokenomics</button>
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
                        <img src="/binance-logo-1.png" alt="Binance" className="w-3 h-3 object-contain" /> BINANCE ECOSYSTEM
                      </span>
                      <span className="flex items-center gap-1 text-cyan-400 font-bold text-[10px] border border-cyan-500/30 px-3 py-1 rounded-full bg-cyan-900/30">
                        <span>🥞</span> PANCAKESWAP
                      </span>
                   </div>
                </div>

                <div className="px-6 w-full mt-8">
                   <p className="text-gray-300 text-sm leading-relaxed mb-8 font-medium text-center">
                     Welcome to the next generation of cloud infrastructure. Built natively on the <strong className="text-yellow-500">Binance Smart Chain (BSC)</strong> for extreme scalability and ultra-low fees, Apex Network offers a seamless Web3 mining ecosystem directly inside Telegram.
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
                         <h3 className="font-bold text-white text-sm">BEP-20 Security</h3>
                         <p className="text-gray-400 text-[10px] mt-1">Audited smart contract & liquidity.</p>
                      </div>
                      <div className="bg-slate-900/80 p-4 rounded-xl border border-slate-800 text-center">
                         <span className="text-3xl block mb-2">🚀</span>
                         <h3 className="font-bold text-white text-sm">PancakeSwap LP</h3>
                         <p className="text-gray-400 text-[10px] mt-1">Guaranteed decentralized trading.</p>
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
                       The blockchain industry is highly volatile. The Core Team reserves the absolute right to amend, delay, or restructure the Whitepaper, Tokenomics, and Roadmap phases at any time due to unforeseen force majeure events, global regulatory changes, or shifting market dynamics to protect the ecosystem's integrity.
                     </p>
                   </div>
                </div>
             </div>
          )}

          {discoverView === 'roadmap' && (
             <div className="px-6 pt-8 w-full">
                <h2 className="text-2xl font-black text-white mb-8 text-center uppercase tracking-widest">Apex Roadmap</h2>
                <div className="relative border-l-2 border-slate-700 ml-3 pl-6 space-y-10 pb-8">
                  {/* Q4 2026 */}
                  <div className="relative">
                    <span className="absolute -left-[31px] top-1 w-4 h-4 bg-yellow-500 rounded-full ring-4 ring-slate-950 shadow-[0_0_10px_rgba(234,179,8,0.8)]"></span>
                    <h3 className="font-black text-yellow-400 text-lg mb-1">Q4 2026: Genesis Launch</h3>
                    <ul className="text-gray-400 text-xs leading-relaxed list-disc ml-4 space-y-1">
                      <li>Official Launch of Apex Network Telegram app</li>
                      <li>Start mining and accumulating APXN points</li>
                      <li>Daily Check-In & Social Tasks system</li>
                      <li>Invite Friends & Referral rewards</li>
                      <li>Wallet linking integration</li>
                    </ul>
                  </div>

                  {/* Q1 2027 */}
                  <div className="relative">
                    <span className="absolute -left-[31px] top-1 w-4 h-4 bg-blue-500 rounded-full ring-4 ring-slate-950"></span>
                    <h3 className="font-black text-blue-400 text-lg mb-1">Q1 2027: Mining & Engagement</h3>
                    <ul className="text-gray-400 text-xs leading-relaxed list-disc ml-4 space-y-1">
                      <li>Enhancing the point mining system & Mining Speed</li>
                      <li>Daily Streak system improvements</li>
                      <li>Additional tasks and rewards</li>
                      <li>Referral system & activity tiers upgrades</li>
                      <li>UI/UX improvements inside Telegram</li>
                    </ul>
                  </div>

                  {/* Q2 2027 */}
                  <div className="relative">
                    <span className="absolute -left-[31px] top-1 w-4 h-4 bg-purple-500 rounded-full ring-4 ring-slate-950"></span>
                    <h3 className="font-black text-purple-400 text-lg mb-1">Q2 2027: Rig Upgrades & Presale</h3>
                    <ul className="text-gray-400 text-xs leading-relaxed list-disc ml-4 space-y-1">
                      <li>Launch of Rig Upgrades (GPU Overclock, Cloud Server, Quantum ASIC)</li>
                      <li>Burning points for internal upgrades</li>
                      <li><strong className="text-white">Initiation of the Phased Presale (Runs continuously until Listing)</strong></li>
                    </ul>
                  </div>

                  {/* Q3 2027 */}
                  <div className="relative">
                    <span className="absolute -left-[31px] top-1 w-4 h-4 bg-green-500 rounded-full ring-4 ring-slate-950"></span>
                    <h3 className="font-black text-green-400 text-lg mb-1">Q3 2027: Community & Growth</h3>
                    <ul className="text-gray-400 text-xs leading-relaxed list-disc ml-4 space-y-1">
                      <li>Expansion of the referral system & global community</li>
                      <li>Advanced user tiers & continuous activity rewards</li>
                      <li>Additional community campaigns</li>
                      <li><strong className="text-white">Phased Presale ongoing</strong></li>
                    </ul>
                  </div>

                  {/* Q4 2027 */}
                  <div className="relative">
                    <span className="absolute -left-[31px] top-1 w-4 h-4 bg-orange-500 rounded-full ring-4 ring-slate-950"></span>
                    <h3 className="font-black text-orange-400 text-lg mb-1">Q4 2027: Ecosystem Expansion</h3>
                    <ul className="text-gray-400 text-xs leading-relaxed list-disc ml-4 space-y-1">
                      <li>Telegram Mini App optimization</li>
                      <li>Mining & upgrades enhancements</li>
                      <li>Security infrastructure development</li>
                      <li>Technical preparation for upcoming phases</li>
                    </ul>
                  </div>

                  {/* Q1 2028 */}
                  <div className="relative">
                    <span className="absolute -left-[31px] top-1 w-4 h-4 bg-cyan-500 rounded-full ring-4 ring-slate-950"></span>
                    <h3 className="font-black text-cyan-400 text-lg mb-1">Q1 2028: Platform Optimization</h3>
                    <ul className="text-gray-400 text-xs leading-relaxed list-disc ml-4 space-y-1">
                      <li>Enhancing app speed, stability, and point economy</li>
                      <li>Security stress tests for current infrastructure</li>
                      <li>Preparing the system for the token transition phase</li>
                      <li><strong className="text-white">Phased Presale ongoing</strong></li>
                    </ul>
                  </div>

                  {/* Q2 2028 */}
                  <div className="relative">
                    <span className="absolute -left-[31px] top-1 w-4 h-4 bg-red-500 rounded-full ring-4 ring-slate-950"></span>
                    <h3 className="font-black text-red-400 text-lg mb-1">Q2 2028: Token Preparation</h3>
                    <ul className="text-gray-400 text-xs leading-relaxed list-disc ml-4 space-y-1">
                      <li>Preparation for APXN Tokenomics</li>
                      <li>Security systems final review</li>
                      <li>Global community expansion</li>
                      <li>Preparation for the major announcement</li>
                    </ul>
                  </div>

                  {/* Q3 2028 */}
                  <div className="relative">
                    <span className="absolute -left-[31px] top-1 w-4 h-4 bg-pink-500 rounded-full ring-4 ring-slate-950"></span>
                    <h3 className="font-black text-pink-400 text-lg mb-1">Q3 2028: Listing Announcement</h3>
                    <ul className="text-gray-400 text-xs leading-relaxed list-disc ml-4 space-y-1">
                      <li><strong className="text-white">Conclusion of the Phased Presale</strong></li>
                      <li>Official APXN Listing Announcement</li>
                      <li>Announcement of supported trading platforms (DEX/CEX)</li>
                      <li>Transition from Points phase to Token phase</li>
                      <li>Announcement of Apex Testnet</li>
                    </ul>
                  </div>

                  {/* Q4 2028 */}
                  <div className="relative">
                    <span className="absolute -left-[31px] top-1 w-4 h-4 bg-indigo-500 rounded-full ring-4 ring-slate-950"></span>
                    <h3 className="font-black text-indigo-400 text-lg mb-1">Q4 2028: Apex Testnet</h3>
                    <ul className="text-gray-400 text-xs leading-relaxed list-disc ml-4 space-y-1">
                      <li>Apex Network Testnet Launch</li>
                      <li>Network, transaction, and security testing</li>
                      <li>Opening the network for developers</li>
                      <li>Testnet Explorer launch</li>
                    </ul>
                  </div>

                  {/* Q1 2029 */}
                  <div className="relative">
                    <span className="absolute -left-[31px] top-1 w-4 h-4 bg-teal-500 rounded-full ring-4 ring-slate-950"></span>
                    <h3 className="font-black text-teal-400 text-lg mb-1">Q1 2029: Testnet Expansion</h3>
                    <ul className="text-gray-400 text-xs leading-relaxed list-disc ml-4 space-y-1">
                      <li>Testnet performance optimization</li>
                      <li>Fixing bugs & scaling the network</li>
                      <li>Developer support and stability metrics</li>
                      <li>Preparation for Staking system</li>
                    </ul>
                  </div>

                  {/* Q2 2029 */}
                  <div className="relative">
                    <span className="absolute -left-[31px] top-1 w-4 h-4 bg-lime-500 rounded-full ring-4 ring-slate-950"></span>
                    <h3 className="font-black text-lime-400 text-lg mb-1">Q2 2029: Staking Implementation</h3>
                    <ul className="text-gray-400 text-xs leading-relaxed list-disc ml-4 space-y-1">
                      <li>Launch of Apex Staking</li>
                      <li>APXN staking rewards system</li>
                      <li>Validators / Nodes testing</li>
                      <li>Staking security audits</li>
                    </ul>
                  </div>

                  {/* Q3 2029 */}
                  <div className="relative">
                    <span className="absolute -left-[31px] top-1 w-4 h-4 bg-amber-500 rounded-full ring-4 ring-slate-950"></span>
                    <h3 className="font-black text-amber-400 text-lg mb-1">Q3 2029: Mainnet Preparation</h3>
                    <ul className="text-gray-400 text-xs leading-relaxed list-disc ml-4 space-y-1">
                      <li>Final security audits</li>
                      <li>Preparing Apex Mainnet & Mainnet Explorer</li>
                      <li>Validators setup & final documentation</li>
                      <li>Official readiness announcement</li>
                    </ul>
                  </div>

                  {/* Q4 2029 */}
                  <div className="relative">
                    <span className="absolute -left-[31px] top-1 w-4 h-4 bg-emerald-500 rounded-full ring-4 ring-slate-950 animate-pulse"></span>
                    <h3 className="font-black text-emerald-400 text-lg mb-1">Q4 2029: Apex Mainnet Launch</h3>
                    <ul className="text-gray-400 text-xs leading-relaxed list-disc ml-4 space-y-1">
                      <li><strong className="text-white">Apex Network Mainnet Official Launch</strong></li>
                      <li>APXN running natively on Mainnet</li>
                      <li>Activating Staking on Mainnet</li>
                      <li>Mainnet Explorer launch</li>
                      <li>Ecosystem and global partnerships expansion</li>
                    </ul>
                  </div>
                </div>

                <div className="mt-12 mb-4">
                  <h3 className="text-center text-gray-400 font-black tracking-widest text-[10px] uppercase mb-6">Core Project Flow</h3>
                  <div className="flex flex-col gap-2 items-center">
                    <div className="bg-slate-900 border border-slate-700 px-4 py-2 rounded-lg text-xs font-bold text-gray-300 shadow-md">Telegram App</div>
                    <div className="h-4 w-[2px] bg-yellow-500"></div>
                    <div className="bg-slate-900 border border-slate-700 px-4 py-2 rounded-lg text-xs font-bold text-gray-300 shadow-md">Daily Activity & Mining Points</div>
                    <div className="h-4 w-[2px] bg-yellow-500"></div>
                    <div className="bg-slate-900 border border-slate-700 px-4 py-2 rounded-lg text-xs font-bold text-gray-300 shadow-md">Tasks & Referrals</div>
                    <div className="h-4 w-[2px] bg-yellow-500"></div>
                    <div className="bg-slate-900 border border-yellow-600/50 px-4 py-2 rounded-lg text-xs font-bold text-yellow-500 shadow-md">Rig Upgrades & Phased Presale</div>
                    <div className="h-4 w-[2px] bg-yellow-500"></div>
                    <div className="bg-slate-900 border border-slate-700 px-4 py-2 rounded-lg text-xs font-bold text-gray-300 shadow-md">Community Growth</div>
                    <div className="h-4 w-[2px] bg-purple-500"></div>
                    <div className="bg-gradient-to-r from-purple-900 to-indigo-900 border border-purple-500 px-4 py-2 rounded-lg text-xs font-bold text-white shadow-[0_0_10px_rgba(168,85,247,0.4)]">Listing Announcement (Q3 2028)</div>
                    <div className="h-4 w-[2px] bg-blue-500"></div>
                    <div className="bg-gradient-to-r from-blue-900 to-cyan-900 border border-blue-500 px-4 py-2 rounded-lg text-xs font-bold text-white shadow-[0_0_10px_rgba(59,130,246,0.4)]">Apex Testnet (Q4 2028)</div>
                    <div className="h-4 w-[2px] bg-green-500"></div>
                    <div className="bg-slate-900 border border-green-500 px-4 py-2 rounded-lg text-xs font-bold text-green-400 shadow-[0_0_10px_rgba(34,197,94,0.2)]">Staking (2029)</div>
                    <div className="h-4 w-[2px] bg-emerald-500"></div>
                    <div className="bg-gradient-to-r from-emerald-600 to-teal-600 border border-emerald-400 px-6 py-3 rounded-xl text-sm font-black text-white shadow-[0_0_20px_rgba(16,185,129,0.5)]">APEX MAINNET (Q4 2029)</div>
                  </div>
                </div>
             </div>
          )}

          {discoverView === 'whitepaper' && (
             <div className="px-6 pt-6 w-full">
                <h1 className="text-2xl font-black text-transparent bg-clip-text bg-gradient-to-r from-yellow-400 to-orange-500 text-center uppercase tracking-widest mb-6">Tokenomics & Security</h1>

                <h2 className="text-lg font-bold text-white border-b border-slate-700 pb-2 mb-4">Smart Contract & Transparency</h2>
                <div className="bg-slate-900/80 p-4 rounded-xl border border-emerald-500/50 mb-6 flex flex-col gap-3 shadow-[0_0_15px_rgba(16,185,129,0.1)]">
                  <div className="flex items-center gap-2">
                     <span className="text-xl">🛡️</span>
                     <h3 className="font-bold text-emerald-400 text-sm">Verified & Audited Contract</h3>
                  </div>
                  <p className="text-[11px] text-gray-300 leading-relaxed">
                    Apex Network ($APXN) is built using standard, audited smart contracts via <strong className="text-white">Thirdweb</strong>. The code contains NO mint functions, NO hidden taxes, and the total supply is strictly fixed.
                  </p>
                  <div className="bg-black/50 p-2 rounded-lg border border-slate-700 mt-1">
                    <span className="block text-[9px] text-gray-500 uppercase mb-1">Contract Address (BSC BEP-20)</span>
                    <span className="block text-[11px] font-mono text-yellow-400 break-all">0x88074bA197BBB0a3AFF891E52d05764F98509956</span>
                  </div>
                  <a href="https://bscscan.com/token/0x88074bA197BBB0a3AFF891E52d05764F98509956#transactions" target="_blank" rel="noopener noreferrer" className="mt-2 w-full bg-emerald-600/20 border border-emerald-500/50 text-emerald-400 py-2 rounded-lg text-xs font-bold text-center flex items-center justify-center gap-2 hover:bg-emerald-600/40 transition-colors">
                    <span>🔍</span> Verify on BscScan
                  </a>
                </div>

                <h2 className="text-lg font-bold text-white border-b border-slate-700 pb-2 mb-4">Initial Coin Offering (ICO)</h2>
                <div className="bg-gradient-to-br from-yellow-900/40 to-orange-900/40 p-4 rounded-xl border border-yellow-500/50 mb-8 relative overflow-hidden">
                  <div className="absolute top-0 right-0 bg-yellow-500 text-black text-[9px] font-black px-2 py-1 rounded-bl-lg uppercase">Active Phase</div>
                  <h3 className="font-bold text-white text-sm mb-2 flex items-center gap-2">🎟️ Ticket-Based Presale</h3>
                  <p className="text-[11px] text-gray-300 leading-relaxed mb-3">
                    Before our official listing and liquidity injection on PancakeSwap, $APXN is exclusively available through our early-access Ticket System inside this app.
                  </p>
                  <div className="flex items-center justify-between bg-black/40 p-3 rounded-lg border border-yellow-700/50">
                     <span className="text-xs text-gray-400 font-bold">ICO Ticket Price:</span>
                     <span className="text-lg font-black text-green-400">0.10 $ <span className="text-[10px] text-gray-500 font-normal">/ APXN</span></span>
                  </div>
                </div>

                <h2 className="text-lg font-bold text-white border-b border-slate-700 pb-2 mb-4">Airdrop Conversion Criteria</h2>
                <div className="bg-slate-900/50 p-4 rounded-xl border border-yellow-700/50 mb-8">
                  <p className="text-gray-300 text-xs leading-relaxed mb-3">
                    APXN Points collected in-app will be converted to real $APXN tokens during TGE. The conversion ratio is strictly dependent on:
                  </p>
                  <ul className="text-xs text-gray-400 space-y-2 ml-4 list-disc">
                    <li><strong className="text-white">Activity Evaluation:</strong> Consistency in daily check-ins (streaks) and active friend referrals.</li>
                    <li><strong className="text-white">In-App Upgrades:</strong> Purchasing hardware boosts utilizing your mined points proves ecosystem loyalty.</li>
                    <li><strong className="text-white">Early Access:</strong> Genesis pioneer accounts will receive favorable multipliers.</li>
                  </ul>
                </div>

                <h2 className="text-lg font-bold text-white border-b border-slate-700 pb-2 mb-4">Distribution Details (100M Total)</h2>

                <div className="space-y-4 mb-8">
                  <div className="bg-slate-900/80 p-4 rounded-xl border border-slate-800 flex flex-col gap-2">
                    <div className="flex justify-between items-center">
                      <span className="font-bold text-white text-sm">Community & Airdrop</span>
                      <span className="bg-blue-600 text-white px-2 py-1 rounded text-[10px] font-black">63%</span>
                    </div>
                    <p className="text-[10px] text-gray-400 leading-relaxed">
                      Allocated entirely to our true supporters. Distributed via the conversion criteria above to ensure a fair and decentralized ecosystem.
                    </p>
                  </div>

                  <div className="bg-slate-900/80 p-4 rounded-xl border border-slate-800 flex flex-col gap-2">
                    <div className="flex justify-between items-center">
                      <span className="font-bold text-white text-sm">DEX & CEX Liquidity</span>
                      <span className="bg-purple-600 text-white px-2 py-1 rounded text-[10px] font-black">20%</span>
                    </div>
                    <p className="text-[10px] text-gray-400 leading-relaxed">
                      Locked liquidity specifically reserved for PancakeSwap (DEX) and top-tier Centralized Exchanges (CEXs) to ensure smooth trading, deep order books, and price stability.
                    </p>
                  </div>

                  <div className="bg-slate-900/80 p-4 rounded-xl border border-slate-800 flex flex-col gap-2">
                    <div className="flex justify-between items-center">
                      <span className="font-bold text-white text-sm">Marketing & Partners</span>
                      <span className="bg-green-600 text-white px-2 py-1 rounded text-[10px] font-black">10%</span>
                    </div>
                    <p className="text-[10px] text-gray-400 leading-relaxed">
                      Strategic fund for global influencer campaigns, KOL onboarding, and future Web3 brand partnerships to drive mass adoption.
                    </p>
                  </div>

                  <div className="bg-slate-900/80 p-4 rounded-xl border border-slate-800 flex flex-col gap-2">
                    <div className="flex justify-between items-center">
                      <span className="font-bold text-white text-sm">Core Team</span>
                      <span className="bg-orange-600 text-white px-2 py-1 rounded text-[10px] font-black">6%</span>
                    </div>
                    <p className="text-[10px] text-gray-400 leading-relaxed">
                      Development allocation. Strictly locked via smart contracts with a prolonged vesting period to align founder incentives with long-term project success.
                    </p>
                  </div>

                  <div className="bg-slate-900/80 p-4 rounded-xl border border-yellow-700/50 flex flex-col gap-2 relative overflow-hidden">
                    <div className="absolute top-0 right-0 w-1 h-full bg-yellow-500"></div>
                    <div className="flex justify-between items-center">
                      <span className="font-bold text-white text-sm">Phased Presale / ICO</span>
                      <span className="bg-red-600 text-white px-2 py-1 rounded text-[10px] font-black">1%</span>
                    </div>
                    <p className="text-[10px] text-gray-400 leading-relaxed">
                      Exclusive early-bird allocation. This phased presale will commence in Q2 2027 and run continuously throughout the project's lifespan until the official TGE announcement.
                    </p>
                  </div>
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



