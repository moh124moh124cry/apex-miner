"use client";
import { useState, useEffect } from 'react';
import { TonConnectButton, useTonAddress, useTonConnectUI } from '@tonconnect/ui-react';
import { supabase } from '../lib/supabase'; 
import Image from 'next/image';

export default function Home() {
  const [balance, setBalance] = useState(0); 
  const [miningDelta, setMiningDelta] = useState(0);
  const [activeTab, setActiveTab] = useState('mine');
  
  // Tasks State
  const [taskCompleted, setTaskCompleted] = useState(false);
  const [groupTaskCompleted, setGroupTaskCompleted] = useState(false); 
  
  // Daily Check-in State
  const [checkinStreak, setCheckinStreak] = useState(0);
  const [canCheckIn, setCanCheckIn] = useState(false);
  const [dailyRewardAmt, setDailyRewardAmt] = useState(100);

  const [friendsCount, setFriendsCount] = useState(0); 
  const [activeFriendsCount, setActiveFriendsCount] = useState(0); 
  const [dbMiningRate, setDbMiningRate] = useState(0.00025); 
  const [totalMiningRate, setTotalMiningRate] = useState(0.00025); 
  
  const [userId, setUserId] = useState(null);
  const [firstName, setFirstName] = useState('');
  const [userName, setUserName] = useState('');
  const [startParam, setStartParam] = useState(null);
  const [dbStatus, setDbStatus] = useState('Connecting...'); 
  const [isSaving, setIsSaving] = useState(false);

  const userAddress = useTonAddress();
  const [tonConnectUI] = useTonConnectUI(); 

  const ADMIN_WALLET = "UQAlWRIbr0ePdYPuc5kV0nEN4gPhLRnqASKWjaCeGPbinBwq"; 

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
          setDbStatus('TG User Found');
        } else {
          setUserId('test_user');
          setDbStatus('Browser User');
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
    async function fetchUserData() {
      if (!userId || userId === 'test_user') return;
      try {
        let currentDbRate = 0.00025; 
        let activeFriends = 0;

        const { data, error } = await supabase.from('users').select('*').eq('telegram_id', userId).single();
        
        if (data) {
          setBalance(Number(data.balance || 0));
          if (data.mining_rate !== undefined && data.mining_rate !== null) {
            currentDbRate = Number(data.mining_rate);
            setDbMiningRate(currentDbRate); 
          }
          if (data.channel_joined) setTaskCompleted(data.channel_joined); 
          if (data.group_joined) setGroupTaskCompleted(data.group_joined); 

          // نظام التحقق من الدخول اليومي والمكافآت (Streak Logic)
          let currentStreak = data.checkin_streak || 0;
          let isCheckinAvailable = true;
          const now = new Date();
          const todayStr = now.toDateString();

          if (data.last_checkin_date) {
            const lastDate = new Date(data.last_checkin_date);
            if (lastDate.toDateString() === todayStr) {
              isCheckinAvailable = false; // سجل دخوله اليوم بالفعل
            } else {
              const yesterday = new Date();
              yesterday.setDate(yesterday.getDate() - 1);
              if (lastDate.toDateString() !== yesterday.toDateString()) {
                currentStreak = 0; // تغيب عن الدخول، يرجع العداد لصفر
              }
            }
          }
          
          setCheckinStreak(currentStreak);
          setCanCheckIn(isCheckinAvailable);
          setDailyRewardAmt(((currentStreak % 7) + 1) * 100); // 100 لليوم الأول، 200 للثاني...

          const { count: totalCount } = await supabase.from('users').select('*', { count: 'exact', head: true }).eq('referred_by', userId);
          setFriendsCount(totalCount || 0);

          const yesterdayStr = new Date(Date.now() - 86400000).toISOString();
          const { count: activeCount } = await supabase.from('users').select('*', { count: 'exact', head: true }).eq('referred_by', userId).gte('last_claim', yesterdayStr);
          activeFriends = activeCount || 0;
          setActiveFriendsCount(activeFriends);

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

          setDbStatus('Data Loaded ✅');
          if (data.username !== userName || data.first_name !== firstName) {
            await supabase.from('users').update({ first_name: firstName, username: userName }).eq('telegram_id', userId);
          }

        } else if (error && error.code === 'PGRST116') {
          let initialBalance = 0;
          let referrerId = (startParam && startParam !== userId) ? startParam : null;
          if (referrerId) initialBalance = 1000; 

          const currentIsoTime = new Date().toISOString();
          const { error: insertError } = await supabase.from('users').insert([{ 
              telegram_id: userId, first_name: firstName, username: userName,
              balance: initialBalance, mining_rate: 0.00025, referred_by: referrerId, 
              channel_joined: false, group_joined: false, checkin_streak: 0, last_claim: currentIsoTime
          }]);

          if (!insertError) {
            setDbStatus('New User Saved ✅');
            setTotalMiningRate(0.00025);
            setCanCheckIn(true);
            setDailyRewardAmt(100);
          } else {
            setDbStatus('Insert Error ❌');
          }
        }
      } catch (err) {
        setDbStatus('Sys Error');
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

  // دالة استلام المكافأة اليومية
  const handleDailyCheckIn = async () => {
    if (!canCheckIn || isSaving) return;
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

  const handleClaim = async () => {
    if (isSaving || miningDelta < 0.0001) return; 
    setIsSaving(true);
    const newTotalBalance = balance + miningDelta;
    const currentIsoTime = new Date().toISOString();
    setBalance(newTotalBalance);
    setMiningDelta(0);
    
    if (userId && userId !== 'test_user') {
      setDbStatus('Saving...');
      const { error } = await supabase.from('users').update({ balance: newTotalBalance, last_claim: currentIsoTime }).eq('telegram_id', userId);
      if (error) {
        setDbStatus('Save Error ❌');
      } else {
        setDbStatus('Saved ✅');
      }
    }
    setTimeout(() => setIsSaving(false), 1000); 
  };

  const handleJoinChannel = async () => {
    if (taskCompleted) return;
    window.open('https://t.me/ApexMiner_Official', '_blank'); 
    const newBalance = balance + 500; 
    setBalance(newBalance);
    setTaskCompleted(true);
    if (userId && userId !== 'test_user') {
      await supabase.from('users').update({ balance: newBalance, channel_joined: true }).eq('telegram_id', userId);
    }
  };

  const handleJoinGroup = async () => {
    if (groupTaskCompleted) return;
    window.open('https://t.me/ApexMinerGroup', '_blank'); 
    const newBalance = balance + 500; 
    setBalance(newBalance);
    setGroupTaskCompleted(true);
    if (userId && userId !== 'test_user') {
      await supabase.from('users').update({ balance: newBalance, group_joined: true }).eq('telegram_id', userId);
    }
  };

  const handleInviteFriend = () => {
    const inviteLink = `https://t.me/ApxMinerBot/app?startapp=${userId}`;
    const shareText = "🚀 Come mine APEX Points with me! Get a 1,000 Points welcome bonus:";
    window.open(`https://t.me/share/url?url=${encodeURIComponent(inviteLink)}&text=${encodeURIComponent(shareText)}`, '_blank');
  };

  const handleCopyLink = () => {
    navigator.clipboard.writeText(`https://t.me/ApxMinerBot/app?startapp=${userId}`);
    alert("✅ Invite link copied!");
  };

  const buyUpgrade = async (costType, costValue, newRateSpeed) => {
    if (dbMiningRate >= newRateSpeed) {
      alert("✅ You already own this or a better upgrade!");
      return;
    }

    const currentIsoTime = new Date().toISOString();
    const autoClaimedBalance = balance + miningDelta;

    if (costType === 'APX') {
      if (autoClaimedBalance >= costValue) {
        const newBalance = autoClaimedBalance - costValue;
        
        if (userId && userId !== 'test_user') {
          const { error } = await supabase.from('users').update({ balance: newBalance, mining_rate: newRateSpeed, last_claim: currentIsoTime }).eq('telegram_id', userId);
          if (error) {
            alert(`❌ Database Error: ${error.message}.`);
            return;
          }
        }
        
        setBalance(newBalance);
        setMiningDelta(0);
        setDbMiningRate(newRateSpeed);
        setTotalMiningRate(newRateSpeed + (activeFriendsCount * (newRateSpeed * 0.05)));
        alert("✅ Upgrade purchased successfully! It is safely stored in the Cloud.");
      } else {
        alert("❌ Not enough APEX Points!");
      }
    } 
    else if (costType === 'GRAM') { 
      if (!userAddress) {
        alert("❌ Please connect your wallet first!");
        return;
      }
      const amountInNano = (costValue * 1000000000).toString(); 
      const transaction = {
        validUntil: Math.floor(Date.now() / 1000) + 300, 
        messages: [{ address: ADMIN_WALLET, amount: amountInNano }]
      };
      
      try {
        setDbStatus('Awaiting Payment...');
        const result = await tonConnectUI.sendTransaction(transaction);
        
        if (result) {
          setDbMiningRate(newRateSpeed);
          setTotalMiningRate(newRateSpeed + (activeFriendsCount * (newRateSpeed * 0.05)));
          setBalance(autoClaimedBalance);
          setMiningDelta(0);
          alert("✅ Payment Confirmed! Activating & Saving to Cloud...");

          if (userId && userId !== 'test_user') {
            const { error } = await supabase.from('users').update({ 
              balance: autoClaimedBalance, 
              mining_rate: newRateSpeed, 
              last_claim: currentIsoTime 
            }).eq('telegram_id', userId);
            
            if (error) {
              alert(`❌ Cloud Sync Error: ${error.message}.`);
              setDbStatus('DB Save Error');
              return;
            }
          }
          setDbStatus('Upgrade Saved ✅');
        }
      } catch (error) {
        console.error(error);
        setDbStatus('Payment Cancelled');
        alert("❌ Payment cancelled or failed.");
      }
    }
  };

  return (
    <main className="flex min-h-screen flex-col items-center bg-slate-950 font-sans overflow-hidden relative pb-24">

      <div className="w-full text-center bg-slate-900 border-b border-slate-800 text-[10px] py-1 text-yellow-400 font-mono">
        Status: {dbStatus}
      </div>

      <div className="w-full flex justify-between items-center p-4">
        <div className="flex items-center gap-2">
          <Image src="/logo2.png" alt="Apex Logo" width={28} height={28} className="rounded-full shadow-[0_0_10px_rgba(96,165,250,0.5)]" />
          <span className="text-xl font-black text-transparent bg-clip-text bg-gradient-to-r from-blue-400 to-purple-500">APEX</span>
        </div>
        <TonConnectButton />
      </div>

      {activeTab === 'mine' && (
        <div className="flex-1 w-full flex flex-col items-center px-6">
          <div className="w-full text-center mt-2">
            <h1 className="text-gray-400 text-xs tracking-widest uppercase mb-2">Total Points</h1>
            <h2 className="text-4xl font-bold text-white">
              {balance.toFixed(4)} <span className="text-xl text-yellow-400 font-black">APEX</span>
            </h2>
          </div>

          <div className="w-full flex flex-col gap-3 mt-6">
            <div className="bg-slate-900/60 border border-slate-800 rounded-2xl p-4 flex justify-between items-center">
               <div className="flex flex-col">
                 <span className="text-gray-400 text-sm font-medium">TOTAL MINING SPEED</span>
                 {activeFriendsCount > 0 && <span className="text-[9px] text-green-400">Includes +5% per active friend</span>}
               </div>
               <span className="font-semibold text-yellow-400 text-xs">+{totalMiningRate.toFixed(5)} APEX/sec</span>
            </div>
          </div>

          <div className="mt-8 text-center">
             <h3 className="text-5xl font-black text-yellow-400 drop-shadow-[0_0_15px_rgba(250,204,21,0.6)] tabular-nums">
               +{miningDelta.toFixed(4)}
             </h3>
          </div>

          <div className="flex-1 flex items-center justify-center my-8 relative w-full">
            <div className="absolute inset-0 bg-blue-500 blur-[80px] opacity-20 rounded-full"></div>
            <div className="w-48 h-48 rounded-full bg-gradient-to-br from-blue-700 to-purple-900 border-4 border-slate-700 flex items-center justify-center shadow-[0_0_40px_rgba(139,92,246,0.4)] z-10 overflow-hidden">
               <Image src="/logo2.png" alt="Apex Coin" width={140} height={140} className="object-contain drop-shadow-[0_0_15px_rgba(255,255,255,0.3)] hover:scale-105 transition-transform duration-300" />
            </div>
          </div>
          <button 
            onClick={handleClaim} 
            disabled={isSaving}
            className={`w-full py-4 mt-auto mb-2 rounded-2xl bg-gradient-to-r from-yellow-500 to-orange-600 text-lg font-bold text-white shadow-[0_4px_20px_rgba(245,158,11,0.4)] active:scale-95 transition-all ${isSaving ? 'opacity-70 cursor-wait' : ''}`}>
            {isSaving ? 'SAVING...' : 'CLAIM POINTS'}
          </button>
        </div>
      )}

      {activeTab === 'tasks' && (
        <div className="flex-1 w-full flex flex-col px-6 pt-4 overflow-y-auto">
          
          {/* واجهة الدخول اليومي (Daily Check-in) الجديدة */}
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

              <button 
                onClick={handleDailyCheckIn} 
                disabled={!canCheckIn || isSaving}
                className={`w-full py-3 rounded-xl text-base font-black uppercase tracking-wider transition-all shadow-lg ${canCheckIn ? 'bg-white text-orange-600 hover:scale-105 active:scale-95' : 'bg-black/30 text-white/50 cursor-not-allowed border border-white/10'}`}
              >
                {isSaving ? 'Claiming...' : (canCheckIn ? 'Claim Reward' : 'Come Back Tomorrow')}
              </button>
            </div>
          </div>

          <h2 className="text-2xl font-bold text-white mb-4">Earn More Points</h2>
          
          <div className="flex flex-col gap-4">
            <div className="bg-slate-900/80 border border-slate-800 rounded-2xl p-4 flex items-center justify-between">
              <div>
                <h3 className="font-bold text-white text-lg">Join Telegram Channel</h3>
                <p className="text-yellow-400 text-xs">+500 APEX Points</p>
              </div>
              <button onClick={handleJoinChannel} disabled={taskCompleted} className={`${taskCompleted ? 'bg-green-600' : 'bg-yellow-600'} px-4 py-2 rounded-xl text-white text-sm font-bold active:scale-95 transition-colors`}>
                {taskCompleted ? 'Done ✓' : 'GO'}
              </button>
            </div>

            <div className="bg-slate-900/80 border border-slate-800 rounded-2xl p-4 flex items-center justify-between">
              <div>
                <h3 className="font-bold text-white text-lg">Join Telegram Group</h3>
                <p className="text-yellow-400 text-xs">+500 APEX Points</p>
              </div>
              <button onClick={handleJoinGroup} disabled={groupTaskCompleted} className={`${groupTaskCompleted ? 'bg-green-600' : 'bg-blue-600'} px-4 py-2 rounded-xl text-white text-sm font-bold active:scale-95 transition-colors`}>
                {groupTaskCompleted ? 'Done ✓' : 'GO'}
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
        </div>
      )}

      {activeTab === 'boosts' && (
        <div className="flex-1 w-full flex flex-col px-6 pt-4 overflow-y-auto">
          <h2 className="text-2xl font-bold text-white mb-2">Rig Upgrades</h2>
          <p className="text-gray-400 text-xs mb-6">Upgrade your hardware to increase your base speed!</p>
          <div className="flex flex-col gap-4">
            <div className="bg-slate-900/80 border border-slate-800 rounded-2xl p-4 flex flex-col gap-3">
              <div className="flex justify-between items-center">
                <div>
                  <h3 className="font-bold text-white text-lg">GPU Overclock</h3>
                  <p className="text-yellow-400 text-sm font-bold">Base Speed: 0.001 pts/sec</p>
                </div>
                <span className="text-2xl">⚙️</span>
              </div>
              <button onClick={() => buyUpgrade('APX', 1000, 0.001)} disabled={dbMiningRate >= 0.001} className={`w-full py-2 rounded-xl text-sm font-bold active:scale-95 transition-colors ${dbMiningRate >= 0.001 ? 'bg-slate-700 text-gray-400' : 'bg-slate-800 text-white border border-slate-700'}`}>
                {dbMiningRate >= 0.001 ? 'Owned ✓' : 'Pay 1,000 Points'}
              </button>
            </div>
            <div className="bg-slate-900/80 border border-slate-800 rounded-2xl p-4 flex flex-col gap-3">
              <div className="flex justify-between items-center">
                <div>
                  <h3 className="font-bold text-white text-lg">Cloud Server Rig</h3>
                  <p className="text-purple-400 text-sm font-bold">Base Speed: 0.003 pts/sec</p>
                </div>
                <span className="text-2xl">☁️</span>
              </div>
              <button onClick={() => buyUpgrade('GRAM', 0.15, 0.003)} disabled={dbMiningRate >= 0.003} className={`w-full py-2 rounded-xl text-sm font-bold active:scale-95 transition-colors ${dbMiningRate >= 0.003 ? 'bg-slate-700 text-gray-400' : 'bg-gradient-to-r from-blue-600 to-purple-600 text-white'}`}>
                {dbMiningRate >= 0.003 ? 'Owned ✓' : 'Buy for 0.15 GRAM'}
              </button>
            </div>
            <div className="bg-slate-900/80 border border-yellow-900/30 rounded-2xl p-4 flex flex-col gap-3">
              <div className="flex justify-between items-center">
                <div>
                  <h3 className="font-bold text-yellow-500 text-lg">Quantum ASIC</h3>
                  <p className="text-yellow-400 text-sm font-bold">Base Speed: 0.01 pts/sec</p>
                </div>
                <span className="text-2xl">🚀</span>
              </div>
              <button onClick={() => buyUpgrade('GRAM', 0.50, 0.01)} disabled={dbMiningRate >= 0.01} className={`w-full py-2 rounded-xl text-sm font-bold active:scale-95 transition-colors ${dbMiningRate >= 0.01 ? 'bg-slate-700 text-gray-400' : 'bg-gradient-to-r from-yellow-600 to-orange-500 text-white'}`}>
                {dbMiningRate >= 0.01 ? 'Owned ✓' : 'Buy for 0.50 GRAM'}
              </button>
            </div>
          </div>
        </div>
      )}

      {activeTab === 'guide' && (
        <div className="flex-1 w-full flex flex-col px-6 pt-6 overflow-y-auto text-left pb-10">
          <h1 className="text-3xl font-black text-transparent bg-clip-text bg-gradient-to-r from-blue-400 to-blue-600 text-center mb-8">How It Works</h1>

          <div className="space-y-4">
            <div className="bg-slate-900/80 p-5 rounded-xl border border-slate-800 shadow-md">
               <div className="flex items-center gap-3 mb-2">
                  <span className="text-2xl">⚡</span>
                  <h3 className="font-bold text-white text-lg">1. Mine APEX Points</h3>
               </div>
               <p className="text-gray-400 text-sm ml-9 leading-relaxed">Your rig mines automatically at your base speed. These virtual APEX points will later be converted to real APX Tokens on the TON network.</p>
            </div>

            <div className="bg-slate-900/80 p-5 rounded-xl border border-slate-800 shadow-md">
               <div className="flex items-center gap-3 mb-2">
                  <span className="text-2xl">👥</span>
                  <h3 className="font-bold text-white text-lg">2. Invite & Earn</h3>
               </div>
               <p className="text-gray-400 text-sm ml-9 leading-relaxed">Grow your squad! You will receive a <strong className="text-green-400">+5% permanent mining speed boost</strong> for every active friend you invite to the app.</p>
            </div>

            <div className="bg-slate-900/80 p-5 rounded-xl border border-slate-800 shadow-md">
               <div className="flex items-center gap-3 mb-2">
                  <span className="text-2xl">🚀</span>
                  <h3 className="font-bold text-white text-lg">3. Upgrade Your Rig</h3>
               </div>
               <p className="text-gray-400 text-sm ml-9 leading-relaxed">Use your mined APEX or real GRAM via TonConnect to purchase powerful Cloud Servers and ASICs for massive speed boosts.</p>
            </div>

            {/* تم إضافة شرح المكافأة اليومية هنا ليكون شرطاً للحصول على الأيردروب */}
            <div className="bg-slate-900/90 p-5 rounded-xl border border-yellow-600/50 shadow-[0_0_15px_rgba(202,138,4,0.15)] relative overflow-hidden">
               <div className="absolute top-0 left-0 w-1 h-full bg-yellow-500"></div>
               <div className="flex items-center gap-3 mb-2">
                  <span className="text-2xl">📅</span>
                  <h3 className="font-bold text-yellow-500 text-lg">4. Check-in & Airdrop</h3>
               </div>
               <p className="text-gray-300 text-sm ml-9 leading-relaxed">
                 Claim your daily check-in reward to build your streak. <strong className="text-red-400">Warning: Missing a single day resets your streak back to zero!</strong><br/><br/>
                 <strong className="text-green-400">Airdrop Factor:</strong> Maintaining a consistent check-in streak proves you are a genuine, active miner. Your streak history will be a critical factor in determining your <strong className="text-white">FULL Airdrop Allocation</strong> during the TGE!
               </p>
            </div>
          </div>
        </div>
      )}

      {activeTab === 'whitepaper' && (
        <div className="flex-1 w-full flex flex-col px-6 pt-6 overflow-y-auto text-left pb-10">
          <h1 className="text-3xl font-black text-transparent bg-clip-text bg-gradient-to-r from-yellow-400 to-orange-500 text-center uppercase tracking-widest mb-1">ApexMiner</h1>
          <p className="text-gray-400 text-xs text-center mb-8">Official Whitepaper & Roadmap v1.1</p>

          <h2 className="text-xl font-bold text-white border-b border-slate-700 pb-2 mb-4">1. Points vs. Tokens System</h2>
          <div className="bg-slate-900/50 p-4 rounded-xl border border-yellow-700/50 mb-6">
            <p className="text-gray-300 text-sm leading-relaxed mb-3">
              To protect the token economy from hyperinflation and ensure a fair distribution over a 2-year mining period, ApexMiner utilizes a dual-system:
            </p>
            <ul className="text-xs text-gray-400 space-y-2 ml-4 list-disc">
              <li><strong className="text-yellow-400">APEX Points (Gold):</strong> The virtual in-game points you are currently mining.</li>
              <li><strong className="text-purple-400">APX Token (Purple):</strong> The real cryptocurrency (1 Billion Supply) on the TON blockchain.</li>
            </ul>
            <p className="text-green-400 text-xs mt-3 font-bold">
              * Secret Conversion: Before the TGE listing, all mined APEX Points will be converted into real APX Tokens. The exact conversion ratio remains highly confidential to prevent bot manipulation and will reward active, genuine users.
            </p>
          </div>

          <h2 className="text-xl font-bold text-white border-b border-slate-700 pb-2 mb-4">2. Technical Token Details</h2>
          <ul className="text-gray-300 text-sm mb-6 space-y-2 bg-slate-900/50 p-4 rounded-xl border border-slate-800">
            <li><strong className="text-purple-400">Token Name:</strong> Apex</li>
            <li><strong className="text-purple-400">Ticker Symbol:</strong> APX</li>
            <li><strong className="text-purple-400">Blockchain:</strong> The Open Network (TON)</li>
            <li><strong className="text-purple-400">Total Supply:</strong> 1,000,000,000 APX <span className="text-yellow-500 font-bold">(Fixed)</span></li>
            <li><strong className="text-purple-400">Smart Contract:</strong> Will be publicly revealed right before the TGE in late 2028.</li>
          </ul>

          <h2 className="text-xl font-bold text-white border-b border-slate-700 pb-2 mb-4">3. Tokenomics & Allocation</h2>
          <div className="space-y-4 mb-8">
            <div className="bg-slate-900/80 p-4 rounded-xl border border-slate-800">
              <h3 className="font-bold text-white mb-1"><span className="bg-blue-600 text-white px-2 py-0.5 rounded text-xs mr-2">63%</span>Community, Mining & Airdrop</h3>
              <p className="text-gray-400 text-xs">630,000,000 APX - Distributed via the secret conversion ratio before listing.</p>
            </div>
            <div className="bg-slate-900/80 p-4 rounded-xl border border-slate-800">
              <h3 className="font-bold text-white mb-1"><span className="bg-purple-600 text-white px-2 py-0.5 rounded text-xs mr-2">20%</span>Liquidity & Exchanges</h3>
              <p className="text-gray-400 text-xs">200,000,000 APX - Allocated to provide necessary liquidity for DEXs & CEXs.</p>
            </div>
            <div className="bg-slate-900/80 p-4 rounded-xl border border-slate-800">
              <h3 className="font-bold text-white mb-1"><span className="bg-green-600 text-white px-2 py-0.5 rounded text-xs mr-2">10%</span>Marketing & Partnerships</h3>
              <p className="text-gray-400 text-xs">100,000,000 APX - Used to fund advertising campaigns, influencer collaborations, and build strategic alliances within the TON ecosystem.</p>
            </div>
            <div className="bg-slate-900/80 p-4 rounded-xl border border-slate-800">
              <h3 className="font-bold text-white mb-1"><span className="bg-orange-600 text-white px-2 py-0.5 rounded text-xs mr-2">5%</span>Core Team & Founders</h3>
              <p className="text-gray-400 text-xs">50,000,000 APX - Allocated to the founding team and developers to fund infrastructure, servers, and long-term project management.</p>
            </div>
            <div className="bg-slate-900/80 p-4 rounded-xl border border-slate-800">
              <h3 className="font-bold text-white mb-1"><span className="bg-red-600 text-white px-2 py-0.5 rounded text-xs mr-2">2%</span>Presale / ICO</h3>
              <p className="text-gray-400 text-xs">20,000,000 APX - A strictly limited allocation that may be offered to early investors to accelerate development. (The team reserves the right to cancel this phase entirely).</p>
            </div>
          </div>

          <h2 className="text-xl font-bold text-white border-b border-slate-700 pb-2 mb-4">4. Strategic Roadmap</h2>
          <div className="border-l-2 border-slate-700 ml-3 pl-4 space-y-6 mb-8">
            <div>
              <div className="flex items-center gap-2 mb-1">
                <div className="w-3 h-3 bg-blue-500 rounded-full -ml-[23px] ring-4 ring-slate-950"></div>
                <h3 className="font-bold text-blue-400">Q4 2026: The Genesis</h3>
              </div>
              <ul className="text-gray-400 text-xs list-disc ml-4 space-y-1">
                <li>Official launch of the ApexMiner Mini-App on Telegram.</li>
                <li>Activation of core mining, referral systems, and hardware upgrades (Boosts).</li>
                <li>Building the foundational user base.</li>
              </ul>
            </div>
            <div>
              <div className="flex items-center gap-2 mb-1">
                <div className="w-3 h-3 bg-purple-500 rounded-full -ml-[23px] ring-4 ring-slate-950"></div>
                <h3 className="font-bold text-purple-400">H1 2027: Gamification</h3>
              </div>
              <ul className="text-gray-400 text-xs list-disc ml-4 space-y-1">
                <li>Launch of the Leaderboard and weekly rewards.</li>
                <li>Introduction of "Squads" to allow group mining.</li>
                <li><strong className="text-yellow-400">First Halving:</strong> Base mining speed of APEX Points is cut in half to increase scarcity.</li>
              </ul>
            </div>
            <div>
              <div className="flex items-center gap-2 mb-1">
                <div className="w-3 h-3 bg-green-500 rounded-full -ml-[23px] ring-4 ring-slate-950"></div>
                <h3 className="font-bold text-green-400">H2 2027: Ecosystem</h3>
              </div>
              <ul className="text-gray-400 text-xs list-disc ml-4 space-y-1">
                <li>Integration of Mini-Games within the app to increase retention and engagement.</li>
                <li>Opening B2B funded advertising tasks for partner projects.</li>
              </ul>
            </div>
            <div>
              <div className="flex items-center gap-2 mb-1">
                <div className="w-3 h-3 bg-yellow-500 rounded-full -ml-[23px] ring-4 ring-slate-950"></div>
                <h3 className="font-bold text-yellow-400">2028: Preparation</h3>
              </div>
              <ul className="text-gray-400 text-xs list-disc ml-4 space-y-1">
                <li>Activation of the internal APX Staking system.</li>
                <li>Converting advanced hardware upgrades into tradable NFTs on TON.</li>
                <li><strong className="text-yellow-400">Second Halving</strong> of point mining speeds.</li>
                <li><strong>Q4 2028:</strong> Closure of mining pools, sweeping of Bot accounts, official reveal of the Smart Contract, and taking the final Snapshot of user point balances.</li>
              </ul>
            </div>
            <div>
              <div className="flex items-center gap-2 mb-1">
                <div className="w-3 h-3 bg-red-500 rounded-full -ml-[23px] ring-4 ring-slate-950"></div>
                <h3 className="font-bold text-red-400">Q1 2029: TGE & Listing</h3>
              </div>
              <ul className="text-gray-400 text-xs list-disc ml-4 space-y-1">
                <li>Token Generation Event (TGE) and Airdrop distribution of real APX Tokens to active users' wallets.</li>
                <li>Official listing of APX on cryptocurrency exchanges for public trading.</li>
              </ul>
            </div>
          </div>

          <div className="bg-red-900/20 border-l-4 border-red-500 p-4 rounded-r-xl mb-4">
            <h3 className="text-red-400 font-bold text-sm mb-1">Disclaimer</h3>
            <p className="text-gray-400 text-xs leading-relaxed">
              Due to the rapidly evolving nature of cryptocurrency markets, all information contained in this whitepaper and roadmap timelines are flexible and subject to change by the management to ensure the continuity and success of the ApexMiner project.
            </p>
          </div>
        </div>
      )}

      <div className="fixed bottom-0 left-0 w-full bg-slate-950/95 backdrop-blur-xl border-t border-slate-800 p-2 flex justify-between items-center z-50">
        <button onClick={() => setActiveTab('mine')} className={`flex flex-col items-center gap-1 flex-1 ${activeTab === 'mine' ? 'text-yellow-400 scale-110 transition-transform' : 'text-gray-500'}`}>
          <span className="text-xl">⛏️</span><span className="text-[9px] font-bold">Mine</span>
        </button>
        <button onClick={() => setActiveTab('tasks')} className={`flex flex-col items-center gap-1 flex-1 ${activeTab === 'tasks' ? 'text-yellow-400 scale-110 transition-transform' : 'text-gray-500'}`}>
          <span className="text-xl">📋</span><span className="text-[9px] font-bold">Earn</span>
        </button>
        <button onClick={() => setActiveTab('friends')} className={`flex flex-col items-center gap-1 flex-1 ${activeTab === 'friends' ? 'text-yellow-400 scale-110 transition-transform' : 'text-gray-500'}`}>
          <span className="text-xl">👥</span><span className="text-[9px] font-bold">Friends</span>
        </button>
        <button onClick={() => setActiveTab('boosts')} className={`flex flex-col items-center gap-1 flex-1 ${activeTab === 'boosts' ? 'text-purple-400 scale-110 transition-transform' : 'text-gray-500'}`}>
          <span className="text-xl">🚀</span><span className="text-[9px] font-bold">Boosts</span>
        </button>
        <button onClick={() => setActiveTab('guide')} className={`flex flex-col items-center gap-1 flex-1 ${activeTab === 'guide' ? 'text-blue-400 scale-110 transition-transform' : 'text-gray-500'}`}>
          <span className="text-xl">📖</span><span className="text-[9px] font-bold">Guide</span>
        </button>
        <button onClick={() => setActiveTab('whitepaper')} className={`flex flex-col items-center gap-1 flex-1 ${activeTab === 'whitepaper' ? 'text-yellow-500 scale-110 transition-transform' : 'text-gray-500'}`}>
          <span className="text-xl">📄</span><span className="text-[9px] font-bold">Docs</span>
        </button>
      </div>
    </main>
  );
}
