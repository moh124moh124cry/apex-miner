"use client";
import { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase'; 
import Image from 'next/image';

export default function Home() {
  const [balance, setBalance] = useState(0); 
  const [isDataLoaded, setIsDataLoaded] = useState(false); // ✅ تمت إضافة متغير التحميل هنا
  const [miningDelta, setMiningDelta] = useState(0);
  const [activeTab, setActiveTab] = useState('mine');
  
  const [discoverView, setDiscoverView] = useState('about'); 
  
  const [taskCompleted, setTaskCompleted] = useState(false);
  const [groupTaskCompleted, setGroupTaskCompleted] = useState(false); 
  const [twitterTaskCompleted, setTwitterTaskCompleted] = useState(false); 
  
  // --- متغيرات المهام اليومية الديناميكية ---
  const [dailyTwitterLink, setDailyTwitterLink] = useState('');
  const [dailyTelegramLink, setDailyTelegramLink] = useState('');
  const [dailyTwitterDone, setDailyTwitterDone] = useState(false);
  const [dailyTelegramDone, setDailyTelegramDone] = useState(false);
  const [verifyingTwitter, setVerifyingTwitter] = useState(false);
  const [verifyingTelegram, setVerifyingTelegram] = useState(false);
  // ------------------------------------------

  const [checkinStreak, setCheckinStreak] = useState(0);
  const [canCheckIn, setCanCheckIn] = useState(false);
  const [dailyRewardAmt, setDailyRewardAmt] = useState(100);

  const [friendsCount, setFriendsCount] = useState(0); 
  const [activeFriendsCount, setActiveFriendsCount] = useState(0); 
  const [friendsList, setFriendsList] = useState([]); 
  
  const [dbMiningRate, setDbMiningRate] = useState(0.00025); 
  const [totalMiningRate, setTotalMiningRate] = useState(0.00025); 
  
  const [userId, setUserId] = useState(null);
  const [firstName, setFirstName] = useState('');
  const [userName, setUserName] = useState('');
  const [startParam, setStartParam] = useState(null);
  const [isSaving, setIsSaving] = useState(false);

  const [showWelcome, setShowWelcome] = useState(false);
  const [welcomeAmount, setWelcomeAmount] = useState(0);

  const [showWalletModal, setShowWalletModal] = useState(false);
  const [walletAddress, setWalletAddress] = useState(null);
  const [isConnecting, setIsConnecting] = useState(false);
  const [selectedWallet, setSelectedWallet] = useState('');
  
  const [manualWalletInput, setManualWalletInput] = useState(false);
  const [tempAddress, setTempAddress] = useState('');

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
    const getTelegramUser = () => {
      if (typeof window !== 'undefined' && window.Telegram?.WebApp) {
        window.Telegram.WebApp.ready();
        window.Telegram.WebApp.expand(); 
        
        const user = window.Telegram.WebApp.initDataUnsafe?.user;
        const param = window.Telegram.WebApp.initDataUnsafe?.start_param;
        if (user) {
          setUserId(user.id.toString());
          setFirstName(user.first_name || 'Unknown');
          setUserName(user.username || 'No Username');
          setStartParam(param);
        } else {
          setUserId('test_user');
        }
      } else {
        attempts++;
        if (attempts < 10) setTimeout(getTelegramUser, 500);
        else setUserId('test_user');
      }
    };
    getTelegramUser();
  }, []);

  useEffect(() => {
    const saveUserCountry = async () => {
      if (!userId || userId === 'test_user') return; 
      try {
        await fetch('/api/user', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ telegramId: userId })
        });
      } catch (error) { }
    };
    saveUserCountry();
  }, [userId]);

  useEffect(() => {
    async function fetchUserData() {
      if (!userId || userId === 'test_user') return;
      try {
        let currentDbRate = 0.00025; 
        let activeFriends = 0;

        const { data: settings } = await supabase.from('app_settings').select('daily_twitter_link, daily_telegram_link').eq('id', 1).single();
        if (settings) {
          setDailyTwitterLink(settings.daily_twitter_link);
          setDailyTelegramLink(settings.daily_telegram_link);
        }

        const { data, error } = await supabase.from('users').select('*').eq('telegram_id', userId).single();
        
        if (data) {
          setBalance(Number(data.balance || 0));
          if (data.mining_rate !== undefined && data.mining_rate !== null) {
            currentDbRate = Number(data.mining_rate);
            setDbMiningRate(currentDbRate); 
          }
          if (data.channel_joined) setTaskCompleted(data.channel_joined); 
          if (data.group_joined) setGroupTaskCompleted(data.group_joined); 
          if (data.twitter_joined) setTwitterTaskCompleted(data.twitter_joined); 

          const todayStr = new Date().toISOString().split('T')[0];
          setDailyTwitterDone(data.last_twitter_task === todayStr);
          setDailyTelegramDone(data.last_telegram_task === todayStr);

          let currentStreak = data.checkin_streak || 0;
          let isCheckinAvailable = true;
          const now = new Date();
          const todayStrFull = now.toDateString();

          if (data.last_checkin_date) {
            const lastDate = new Date(data.last_checkin_date);
            if (lastDate.toDateString() === todayStrFull) {
              isCheckinAvailable = false; 
            } else {
              const yesterday = new Date();
              yesterday.setDate(yesterday.getDate() - 1);
              if (lastDate.toDateString() !== yesterday.toDateString()) {
                currentStreak = 0; 
              }
            }
          }
          
          setCheckinStreak(currentStreak);
          setCanCheckIn(isCheckinAvailable);
          setDailyRewardAmt(((currentStreak % 7) + 1) * 100); 

          const { data: friendsData } = await supabase
            .from('users')
            .select('first_name, country, last_claim')
            .eq('referred_by', userId)
            .order('last_claim', { ascending: false });

          if (friendsData) {
            setFriendsList(friendsData);
            setFriendsCount(friendsData.length);
            
            const yesterdayStr = new Date(Date.now() - 86400000).toISOString();
            activeFriends = friendsData.filter(f => f.last_claim >= yesterdayStr).length;
            setActiveFriendsCount(activeFriends);
          } else {
            setFriendsCount(0);
            setActiveFriendsCount(0);
          }

          const friendsBonus = activeFriends * (currentDbRate * 0.05);
          const finalRate = currentDbRate + friendsBonus;
          setTotalMiningRate(finalRate);
          
          if (data.last_claim) {
            const lastTime = new Date(data.last_claim).getTime();
            const nowTime = new Date().getTime();
            const diffSeconds = (nowTime - lastTime) / 1000;
            if (diffSeconds > 0) {
              setMiningDelta(diffSeconds * finalRate);
            }
          }

          if (data.username !== userName || data.first_name !== firstName) {
            await supabase.from('users').update({ first_name: firstName, username: userName }).eq('telegram_id', userId);
          }

          setIsDataLoaded(true); // ✅ التأكيد على أن البيانات تم تحميلها بنجاح

        } else if (error && error.code === 'PGRST116') {
          const { count: totalUsers } = await supabase.from('users').select('*', { count: 'exact', head: true });
          let currentTotal = totalUsers || 0;
          
          let welcomeBonus = 1000;
          if (currentTotal < 10000) welcomeBonus = 10000;
          else if (currentTotal < 50000) welcomeBonus = 5000;
          else if (currentTotal < 100000) welcomeBonus = 2500;
          else welcomeBonus = 1000;

          let initialBalance = welcomeBonus;
          let referrerId = (startParam && startParam !== userId) ? startParam : null;
          
          if (referrerId) {
             initialBalance += 1000; 
          }

          const currentIsoTime = new Date().toISOString();
          const { error: insertError } = await supabase.from('users').insert([{ 
              telegram_id: userId, 
              first_name: firstName, 
              username: userName,
              balance: initialBalance, 
              mining_rate: 0.00025, 
              referred_by: referrerId, 
              channel_joined: false, 
              group_joined: false, 
              twitter_joined: false,
              checkin_streak: 0, 
              last_checkin_date: null,
              last_claim: currentIsoTime
          }]);

          if (!insertError) {
            setBalance(initialBalance);
            setTotalMiningRate(0.00025);
            setCanCheckIn(true);
            setDailyRewardAmt(100);
            setWelcomeAmount(welcomeBonus);
            setShowWelcome(true);
            setIsDataLoaded(true); // ✅ التأكيد على أن المستخدم الجديد تم إنشاؤه وتحميل بياناته
          }
        }
      } catch (err) {
        console.error('System Error');
      }
    }
    if (firstName || userName) fetchUserData();
  }, [userId, firstName, userName, startParam]);

  useEffect(() => {
    const interval = setInterval(() => {
      setMiningDelta(prev => prev + totalMiningRate);
    }, 1000);
    return () => clearInterval(interval);
  }, [totalMiningRate]);

  // ✅ تمت حماية الدالة للعمل فقط بعد تحميل البيانات
  const handleDailyCheckIn = async () => {
    if (!isDataLoaded || !canCheckIn || isSaving) return;
    setIsSaving(true);
    
    const newStreak = checkinStreak + 1;
    const newBalance = balance + dailyRewardAmt;
    const todayIso = new Date().toISOString();

    setBalance(newBalance);
    setCheckinStreak(newStreak);
    setCanCheckIn(false);

    if (userId && userId !== 'test_user') {
      await supabase.from('users').update({ 
        balance: newBalance, 
        checkin_streak: newStreak, 
        last_checkin_date: todayIso 
      }).eq('telegram_id', userId);
    }
    setIsSaving(false);
  };

  // ✅ تمت حماية الدالة للعمل فقط بعد تحميل البيانات
  const handleClaim = async () => {
    if (!isDataLoaded || isSaving || miningDelta < 0.0001) return; 
    setIsSaving(true);
    const newTotalBalance = balance + miningDelta;
    const currentIsoTime = new Date().toISOString();
    setBalance(newTotalBalance);
    setMiningDelta(0);
    
    if (userId && userId !== 'test_user') {
      await supabase.from('users').update({ balance: newTotalBalance, last_claim: currentIsoTime }).eq('telegram_id', userId);
    }
    setTimeout(() => setIsSaving(false), 1000); 
  };

  // ✅ تمت حماية الدالة للعمل فقط بعد تحميل البيانات
  const handleDailyTwitter = async () => {
    if (!isDataLoaded || dailyTwitterDone || verifyingTwitter || !dailyTwitterLink) return;
    window.open(dailyTwitterLink, '_blank');
    setVerifyingTwitter(true);
    setTimeout(async () => {
      const today = new Date().toISOString().split('T')[0];
      const newBalance = balance + 100;
      const { error } = await supabase.from('users').update({ last_twitter_task: today, balance: newBalance }).eq('telegram_id', userId);
      if (!error) {
        setBalance(newBalance);
        setDailyTwitterDone(true);
        setVerifyingTwitter(false);
      }
    }, 10000);
  };

  // ✅ تمت حماية الدالة للعمل فقط بعد تحميل البيانات
  const handleDailyTelegram = async () => {
    if (!isDataLoaded || dailyTelegramDone || verifyingTelegram || !dailyTelegramLink) return;
    window.open(dailyTelegramLink, '_blank');
    setVerifyingTelegram(true);
    setTimeout(async () => {
      const today = new Date().toISOString().split('T')[0];
      const newBalance = balance + 100;
      const { error } = await supabase.from('users').update({ last_telegram_task: today, balance: newBalance }).eq('telegram_id', userId);
      if (!error) {
        setBalance(newBalance);
        setDailyTelegramDone(true);
        setVerifyingTelegram(false);
      }
    }, 10000);
  };

  // ✅ تمت حماية الدالة للعمل فقط بعد تحميل البيانات
  const handleJoinChannel = async () => {
    if (!isDataLoaded || taskCompleted) return;
    window.open('https://t.me/ApexMiner_Official', '_blank'); 
    const newBalance = balance + 500; 
    setBalance(newBalance);
    setTaskCompleted(true);
    if (userId && userId !== 'test_user') {
      await supabase.from('users').update({ balance: newBalance, channel_joined: true }).eq('telegram_id', userId);
    }
  };

  // ✅ تمت حماية الدالة للعمل فقط بعد تحميل البيانات
  const handleJoinGroup = async () => {
    if (!isDataLoaded || groupTaskCompleted) return;
    window.open('https://t.me/ApexMinerGroup', '_blank'); 
    const newBalance = balance + 500; 
    setBalance(newBalance);
    setGroupTaskCompleted(true);
    if (userId && userId !== 'test_user') {
      await supabase.from('users').update({ balance: newBalance, group_joined: true }).eq('telegram_id', userId);
    }
  };

  // ✅ تمت حماية الدالة للعمل فقط بعد تحميل البيانات
  const handleFollowTwitter = async () => {
    if (!isDataLoaded || twitterTaskCompleted) return;
    window.open('https://x.com/ApexNetworkApp', '_blank'); 
    setTwitterTaskCompleted(true);
    const newBalance = balance + 500; 
    setBalance(newBalance);
    if (userId && userId !== 'test_user') {
      try {
        await supabase.from('users').update({ balance: newBalance, twitter_joined: true }).eq('telegram_id', userId);
      } catch (err) {}
    }
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

  return (
    <main className="flex min-h-screen flex-col items-center bg-slate-950 font-sans overflow-hidden relative pb-28">

      {/* مودال ربط المحفظة */}
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
                 {startParam && startParam !== userId && (
                   <span className="block text-xs font-bold text-green-400 mt-3 pt-3 border-t border-yellow-900/50">
                     +1,000 APXN (Friend Referral)
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

      <div className="w-full flex justify-between items-center p-4 z-10 mt-2">
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
               </div>
               <span className="font-semibold text-yellow-400 text-xs">+{totalMiningRate.toFixed(5)} APXN/sec</span>
            </div>
          </div>
          <div className="mt-8 text-center">
             <h3 className="text-5xl font-black text-yellow-400 drop-shadow-[0_0_15px_rgba(250,204,21,0.6)] tabular-nums">
               +{miningDelta.toFixed(4)}
             </h3>
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
          <button onClick={handleClaim} disabled={!isDataLoaded || isSaving} className={`w-full py-4 mt-auto mb-4 rounded-2xl bg-gradient-to-r from-yellow-500 to-orange-600 text-lg font-bold text-white shadow-[0_4px_20px_rgba(245,158,11,0.4)] active:scale-95 transition-all ${(!isDataLoaded || isSaving) ? 'opacity-70 cursor-wait' : ''}`}>
            {!isDataLoaded ? 'LOADING...' : (isSaving ? 'SAVING...' : 'CLAIM POINTS')}
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
                    <span className="block text-[9px] text-yellow-200 uppercase tracking-widest mb-1">Today's Reward</span>
                    <span className="text-2xl font-black text-yellow-400">+{dailyRewardAmt}</span>
                 </div>
              </div>
              <button onClick={handleDailyCheckIn} disabled={!isDataLoaded || !canCheckIn || isSaving} className={`w-full py-3 rounded-xl text-base font-black uppercase tracking-wider transition-all shadow-lg ${(isDataLoaded && canCheckIn) ? 'bg-white text-orange-600 hover:scale-105 active:scale-95' : 'bg-black/30 text-white/50 cursor-not-allowed border border-white/10'}`}>
                {!isDataLoaded ? 'Loading...' : (isSaving ? 'Claiming...' : (canCheckIn ? 'Claim Reward' : 'Come Back Tomorrow'))}
              </button>
            </div>
          </div>
          
          {(dailyTelegramLink || dailyTwitterLink) && (
            <>
              <h2 className="text-2xl font-bold text-white mb-4">Daily Tasks</h2>
              <div className="flex flex-col gap-4 mb-6">
                
                {dailyTelegramLink && (
                <div className="bg-slate-900/80 border border-slate-800 rounded-2xl p-4 flex items-center justify-between">
                  <div>
                    <h3 className="font-bold text-white text-lg">Like Today's Post</h3>
                    <p className="text-yellow-400 text-xs">+100 APXN Points</p>
                  </div>
                  <button onClick={handleDailyTelegram} disabled={!isDataLoaded || dailyTelegramDone || verifyingTelegram} className={`${dailyTelegramDone ? 'bg-green-600' : (!isDataLoaded || verifyingTelegram) ? 'bg-slate-700 animate-pulse' : 'bg-[#2AABEE]'} px-4 py-2 rounded-xl text-white text-sm font-bold active:scale-95 transition-colors min-w-[80px]`}>
                    {dailyTelegramDone ? 'Done ✓' : (!isDataLoaded || verifyingTelegram) ? 'Wait..' : 'GO'}
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
                    {dailyTwitterDone ? 'Done ✓' : (!isDataLoaded || verifyingTwitter) ? 'Wait..' : 'GO'}
                  </button>
                </div>
                )}

              </div>
            </>
          )}
          
          <h2 className="text-2xl font-bold text-white mb-4">One-Time Social Tasks</h2>
          
          <div className="flex flex-col gap-4 mb-8">
            <div className="bg-slate-900/80 border border-slate-800 rounded-2xl p-4 flex items-center justify-between">
              <div>
                <h3 className="font-bold text-white text-lg">Join Telegram Channel</h3>
                <p className="text-yellow-400 text-xs">+500 APXN Points</p>
              </div>
              <button onClick={handleJoinChannel} disabled={!isDataLoaded || taskCompleted} className={`${taskCompleted ? 'bg-green-600' : (!isDataLoaded ? 'bg-slate-700' : 'bg-[#2AABEE]')} px-4 py-2 rounded-xl text-white text-sm font-bold active:scale-95 transition-colors min-w-[80px]`}>
                {taskCompleted ? 'Done ✓' : 'GO'}
              </button>
            </div>
            
            <div className="bg-slate-900/80 border border-slate-800 rounded-2xl p-4 flex items-center justify-between">
              <div>
                <h3 className="font-bold text-white text-lg">Join Telegram Group</h3>
                <p className="text-yellow-400 text-xs">+500 APXN Points</p>
              </div>
              <button onClick={handleJoinGroup} disabled={!isDataLoaded || groupTaskCompleted} className={`${groupTaskCompleted ? 'bg-green-600' : (!isDataLoaded ? 'bg-slate-700' : 'bg-[#229ED9]')} px-4 py-2 rounded-xl text-white text-sm font-bold active:scale-95 transition-colors min-w-[80px]`}>
                {groupTaskCompleted ? 'Done ✓' : 'GO'}
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
              <button onClick={handleFollowTwitter} disabled={!isDataLoaded || twitterTaskCompleted} className={`${twitterTaskCompleted ? 'bg-green-600' : (!isDataLoaded ? 'bg-slate-700' : 'bg-black border border-slate-700')} px-4 py-2 rounded-xl text-white text-sm font-bold active:scale-95 transition-colors min-w-[80px]`}>
                {twitterTaskCompleted ? 'Done ✓' : 'GO'}
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

      {/* قسم المتجر */}
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

      {/* قسم ديسكفر (أبوت/رؤية/الخ) */}
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
                {/* ... (نفس كود Roadmap لم يتغير) ... */}
             </div>
          )}

          {discoverView === 'whitepaper' && (
             <div className="px-6 pt-6 w-full">
                <h1 className="text-2xl font-black text-transparent bg-clip-text bg-gradient-to-r from-yellow-400 to-orange-500 text-center uppercase tracking-widest mb-6">Tokenomics & Security</h1>
                {/* ... (نفس كود Whitepaper لم يتغير) ... */}
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
