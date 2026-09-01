"use client";
import { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase'; 
import Image from 'next/image';

export default function Home() {
  const [balance, setBalance] = useState(0); 
  const [miningDelta, setMiningDelta] = useState(0);
  const [activeTab, setActiveTab] = useState('mine');
  
  const [discoverView, setDiscoverView] = useState('about'); 
  
  const [taskCompleted, setTaskCompleted] = useState(false);
  const [groupTaskCompleted, setGroupTaskCompleted] = useState(false); 
  
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
  const [isSaving, setIsSaving] = useState(false);

  const [showWelcome, setShowWelcome] = useState(false);
  const [welcomeAmount, setWelcomeAmount] = useState(0);

  // نظام المحافظ الجديد BSC (اتصال حقيقي)
  const [showWalletModal, setShowWalletModal] = useState(false);
  const [walletAddress, setWalletAddress] = useState(null);
  const [isConnecting, setIsConnecting] = useState(false);
  const [selectedWallet, setSelectedWallet] = useState('');

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
        } else if (window.ethereum) {
          provider = window.ethereum; 
        }
      }

      if (!provider) {
        alert(`❌ لم يتم العثور على ${walletName}! يرجى فتح التطبيق من متصفح المحفظة (dApp Browser) أو تثبيت الإضافة.`);
        setIsConnecting(false);
        return;
      }

      const accounts = await provider.request({ method: 'eth_requestAccounts' });
      
      if (accounts && accounts.length > 0) {
        const address = accounts[0];
        setWalletAddress(`0x${address.substring(2, 6)}...${address.substring(address.length - 4)}`);
        setShowWalletModal(false);

        // التحويل التلقائي لشبكة BSC
        try {
          await provider.request({
            method: 'wallet_switchEthereumChain',
            params: [{ chainId: '0x38' }], // 0x38 هو الـ Chain ID لشبكة BSC
          });
        } catch (switchError) {
          if (switchError.code === 4902) {
            await provider.request({
              method: 'wallet_addEthereumChain',
              params: [
                {
                  chainId: '0x38',
                  chainName: 'Binance Smart Chain',
                  nativeCurrency: { name: 'BNB', symbol: 'BNB', decimals: 18 },
                  rpcUrls: ['https://bsc-dataseed.binance.org/'],
                  blockExplorerUrls: ['https://bscscan.com/']
                }
              ],
            });
          }
        }
      }
    } catch (error) {
      console.error("Connection error:", error);
      alert("❌ تم إلغاء الاتصال أو حدث خطأ.");
    } finally {
      setIsConnecting(false);
    }
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

          let currentStreak = data.checkin_streak || 0;
          let isCheckinAvailable = true;
          const now = new Date();
          const todayStr = now.toDateString();

          if (data.last_checkin_date) {
            const lastDate = new Date(data.last_checkin_date);
            if (lastDate.toDateString() === todayStr) {
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

          if (data.username !== userName || data.first_name !== firstName) {
            await supabase.from('users').update({ first_name: firstName, username: userName }).eq('telegram_id', userId);
          }

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
      await supabase.from('users').update({ balance: newTotalBalance, last_claim: currentIsoTime }).eq('telegram_id', userId);
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
    const shareText = "🚀 Join Apex Network on BSC and mine $APXN Points! Early pioneer welcome bonus active:";
    window.open(`https://t.me/share/url?url=${encodeURIComponent(inviteLink)}&text=${encodeURIComponent(shareText)}`, '_blank');
  };

  const handleCopyLink = () => {
    navigator.clipboard.writeText(`https://t.me/ApxMinerBot/app?startapp=${userId}`);
    alert("✅ Invite link copied!");
  };

  return (
    <main className="flex min-h-screen flex-col items-center bg-slate-950 font-sans overflow-hidden relative pb-28">

      {showWalletModal && (
        <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
           <div className="bg-slate-900 border border-yellow-500/50 rounded-2xl w-full max-w-sm p-6 relative shadow-[0_0_30px_rgba(234,179,8,0.2)]">
              <button onClick={() => setShowWalletModal(false)} className="absolute top-4 right-4 text-gray-400 hover:text-white text-xl">✖</button>
              <h3 className="text-xl font-black text-white mb-6 text-center flex items-center justify-center gap-2">
                 <span>🟡</span> Connect BSC Wallet
              </h3>
              <div className="flex flex-col gap-3">
                 <button onClick={() => handleConnectWallet('MetaMask')} disabled={isConnecting} className={`w-full flex items-center gap-3 bg-slate-800 p-4 rounded-xl border ${isConnecting && selectedWallet === 'MetaMask' ? 'border-orange-500 bg-slate-800/80' : 'border-slate-700 hover:border-orange-500'} transition-all`}>
                    <span className="text-2xl">🦊</span> 
                    <span className="text-white font-bold text-lg">{isConnecting && selectedWallet === 'MetaMask' ? 'Connecting...' : 'MetaMask'}</span>
                 </button>
                 <button onClick={() => handleConnectWallet('Trust Wallet')} disabled={isConnecting} className={`w-full flex items-center gap-3 bg-slate-800 p-4 rounded-xl border ${isConnecting && selectedWallet === 'Trust Wallet' ? 'border-blue-500 bg-slate-800/80' : 'border-slate-700 hover:border-blue-500'} transition-all`}>
                    <span className="text-2xl">🛡️</span> 
                    <span className="text-white font-bold text-lg">{isConnecting && selectedWallet === 'Trust Wallet' ? 'Connecting...' : 'Trust Wallet'}</span>
                 </button>
                 <button onClick={() => handleConnectWallet('OKX Web3')} disabled={isConnecting} className={`w-full flex items-center gap-3 bg-slate-800 p-4 rounded-xl border ${isConnecting && selectedWallet === 'OKX Web3' ? 'border-white bg-slate-800/80' : 'border-slate-700 hover:border-white'} transition-all`}>
                    <span className="text-2xl font-black text-white px-1">OKX</span> 
                    <span className="text-white font-bold text-lg">{isConnecting && selectedWallet === 'OKX Web3' ? 'Connecting...' : 'OKX Web3'}</span>
                 </button>
              </div>
              <p className="text-[10px] font-bold text-yellow-500 text-center mt-6 uppercase tracking-wider">Supports Binance Smart Chain (BEP-20)</p>
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
        <button onClick={() => setShowWalletModal(true)} className="bg-slate-800 border border-slate-700 text-white font-bold px-4 py-2 rounded-xl text-xs hover:border-yellow-500 transition-colors flex items-center gap-2">
          <span>🟡</span> {walletAddress ? walletAddress : 'Connect Wallet'}
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
            
            <div className="w-56 h-56 rounded-full p-[4px] bg-gradient-to-b from-yellow-300 via-yellow-500 to-yellow-800 shadow-[0_0_50px_rgba(234,179,8,0.4),inset_0_0_20px_rgba(255,255,255,0.5)] z-10 flex items-center justify-center">
              <div className="w-full h-full rounded-full border-[6px] border-slate-950 overflow-hidden shadow-[inset_0_0_30px_rgba(0,0,0,0.8)] relative">
                 <Image src="/logo2.png" alt="Apex Coin" width={200} height={200} className="w-full h-full object-cover rounded-full drop-shadow-[0_0_15px_rgba(255,255,255,0.2)]" />
                 <div className="absolute inset-0 bg-gradient-to-tr from-transparent via-white/10 to-transparent rounded-full pointer-events-none"></div>
              </div>
            </div>
            
          </div>
          <button onClick={handleClaim} disabled={isSaving} className={`w-full py-4 mt-auto mb-4 rounded-2xl bg-gradient-to-r from-yellow-500 to-orange-600 text-lg font-bold text-white shadow-[0_4px_20px_rgba(245,158,11,0.4)] active:scale-95 transition-all ${isSaving ? 'opacity-70 cursor-wait' : ''}`}>
            {isSaving ? 'SAVING...' : 'CLAIM POINTS'}
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
              <button onClick={handleDailyCheckIn} disabled={!canCheckIn || isSaving} className={`w-full py-3 rounded-xl text-base font-black uppercase tracking-wider transition-all shadow-lg ${canCheckIn ? 'bg-white text-orange-600 hover:scale-105 active:scale-95' : 'bg-black/30 text-white/50 cursor-not-allowed border border-white/10'}`}>
                {isSaving ? 'Claiming...' : (canCheckIn ? 'Claim Reward' : 'Come Back Tomorrow')}
              </button>
            </div>
          </div>
          <h2 className="text-2xl font-bold text-white mb-4">Social Tasks</h2>
          <div className="flex flex-col gap-4 mb-8">
            <div className="bg-slate-900/80 border border-slate-800 rounded-2xl p-4 flex items-center justify-between">
              <div>
                <h3 className="font-bold text-white text-lg">Join Telegram Channel</h3>
                <p className="text-yellow-400 text-xs">+500 APXN Points</p>
              </div>
              <button onClick={handleJoinChannel} disabled={taskCompleted} className={`${taskCompleted ? 'bg-green-600' : 'bg-yellow-600'} px-4 py-2 rounded-xl text-white text-sm font-bold active:scale-95 transition-colors`}>
                {taskCompleted ? 'Done ✓' : 'GO'}
              </button>
            </div>
            <div className="bg-slate-900/80 border border-slate-800 rounded-2xl p-4 flex items-center justify-between">
              <div>
                <h3 className="font-bold text-white text-lg">Join Telegram Group</h3>
                <p className="text-yellow-400 text-xs">+500 APXN Points</p>
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
          <p className="text-yellow-500/80 text-[11px] font-bold mb-6 uppercase tracking-wider">
            ⚠️ All Upgrades are currently locked until Smart Contract Deployment.
          </p>
          
          <div className="flex flex-col gap-4 mb-8 opacity-60 grayscale">
            <div className="bg-slate-900/80 border border-slate-800 rounded-2xl p-4 flex flex-col gap-3">
              <div className="flex justify-between items-center">
                <div>
                  <h3 className="font-bold text-white text-lg">GPU Overclock</h3>
                  <p className="text-yellow-400 text-sm font-bold">Speed: +0.001 pts/sec</p>
                </div>
                <span className="text-2xl">⚙️</span>
              </div>
              <button disabled className="w-full py-2 rounded-xl text-xs font-bold bg-slate-800 text-gray-500 border border-slate-700 cursor-not-allowed">
                Locked (Awaiting Contract)
              </button>
            </div>
            
            <div className="bg-slate-900/80 border border-slate-800 rounded-2xl p-4 flex flex-col gap-3">
              <div className="flex justify-between items-center">
                <div>
                  <h3 className="font-bold text-white text-lg">Cloud Server Rig</h3>
                  <p className="text-purple-400 text-sm font-bold">Speed: +0.0025 pts/sec</p>
                </div>
                <span className="text-2xl">☁️</span>
              </div>
              <button disabled className="w-full py-2 rounded-xl text-xs font-bold bg-slate-800 text-gray-500 border border-slate-700 cursor-not-allowed">
                Locked (Awaiting Contract)
              </button>
            </div>

            <div className="bg-slate-900/80 border border-slate-800 rounded-2xl p-4 flex flex-col gap-3">
              <div className="flex justify-between items-center">
                <div>
                  <h3 className="font-bold text-white text-lg">Quantum ASIC</h3>
                  <p className="text-green-400 text-sm font-bold">Speed: +0.006 pts/sec</p>
                </div>
                <span className="text-2xl">🚀</span>
              </div>
              <button disabled className="w-full py-2 rounded-xl text-xs font-bold bg-slate-800 text-gray-500 border border-slate-700 cursor-not-allowed">
                Locked (Awaiting Contract)
              </button>
            </div>
          </div>

          <h2 className="text-2xl font-bold text-white mb-2 border-t border-slate-800 pt-6">VIP Presale Passes</h2>
          <p className="text-gray-500 text-xs mb-4">Exclusive TGE Allocations via BSC Network.</p>
          <div className="flex flex-col gap-4 pb-8 opacity-50 grayscale">
            <div className="bg-gradient-to-br from-slate-800 to-slate-900 border border-slate-700 rounded-2xl p-4 flex flex-col gap-3 relative overflow-hidden">
              <div className="flex justify-between items-center">
                <div>
                  <h3 className="font-bold text-white text-lg">Silver VIP Pass</h3>
                  <p className="text-gray-400 text-[10px]">Guarantees Tier 2 Airdrop Allocation</p>
                </div>
                <span className="text-3xl">🎫</span>
              </div>
              <button disabled className="w-full py-2 rounded-xl text-xs font-bold bg-slate-800 text-gray-500 border border-slate-700 cursor-not-allowed">
                Locked (Awaiting Charts & DEX)
              </button>
            </div>
          </div>

        </div>
      )}

      {activeTab === 'discover' && (
        <div className="flex-1 w-full flex flex-col overflow-y-auto pb-10">
          
          <div className="w-full bg-slate-900/95 backdrop-blur-md border-b border-slate-800 sticky top-0 z-20 flex justify-around p-2">
             <button onClick={() => setDiscoverView('about')} className={`py-2 px-4 rounded-lg text-xs font-bold transition-colors ${discoverView === 'about' ? 'bg-yellow-600 text-slate-900' : 'text-gray-400 hover:text-white'}`}>About</button>
             <button onClick={() => setDiscoverView('roadmap')} className={`py-2 px-4 rounded-lg text-xs font-bold transition-colors ${discoverView === 'roadmap' ? 'bg-yellow-600 text-slate-900' : 'text-gray-400 hover:text-white'}`}>Roadmap</button>
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
                        <span>🟡</span> POWERED BY BSC
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
                   <div className="flex flex-col gap-3 w-full mb-10">
                     <button onClick={() => window.open('https://t.me/ApexMiner_Official', '_blank')} className="w-full bg-[#2AABEE] text-white font-bold py-3 rounded-xl flex items-center justify-center gap-2 shadow-lg active:scale-95 transition-transform">
                        <span>📢</span> Official Channel
                     </button>
                     <button onClick={() => window.open('https://t.me/ApexMinerGroup', '_blank')} className="w-full bg-[#229ED9] text-white font-bold py-3 rounded-xl flex items-center justify-center gap-2 shadow-lg active:scale-95 transition-transform">
                        <span>💬</span> Global Group
                     </button>
                   </div>
                </div>
             </div>
          )}

          {discoverView === 'roadmap' && (
             <div className="px-6 pt-8 w-full">
                <h2 className="text-2xl font-black text-white mb-8 text-center uppercase tracking-widest">BSC Roadmap</h2>
                <div className="relative border-l-2 border-slate-700 ml-3 pl-6 space-y-10 pb-8">
                  <div className="relative">
                    <span className="absolute -left-[31px] top-1 w-4 h-4 bg-blue-500 rounded-full ring-4 ring-slate-950 shadow-[0_0_10px_rgba(59,130,246,0.8)]"></span>
                    <h3 className="font-black text-blue-400 text-lg mb-1">Q1 2027: Genesis & Point Mining</h3>
                    <p className="text-gray-400 text-xs leading-relaxed">
                      Launch of Telegram mining app. Community building and internal APXN points accumulation.
                    </p>
                  </div>
                  <div className="relative">
                    <span className="absolute -left-[31px] top-1 w-4 h-4 bg-purple-500 rounded-full ring-4 ring-slate-950"></span>
                    <h3 className="font-black text-purple-400 text-lg mb-1">Q2 2027: BEP-20 Contract</h3>
                    <p className="text-gray-400 text-xs leading-relaxed">
                      Deployment of the official APXN Smart Contract on Binance Smart Chain. BscScan Verification.
                    </p>
                  </div>
                  <div className="relative">
                    <span className="absolute -left-[31px] top-1 w-4 h-4 bg-green-500 rounded-full ring-4 ring-slate-950"></span>
                    <h3 className="font-black text-green-400 text-lg mb-1">Q3 2027: Presale & Liquidity Gen</h3>
                    <p className="text-gray-400 text-xs leading-relaxed">
                      Exclusive VIP Presale events within the app. Generating initial BNB liquidity.
                    </p>
                  </div>
                  <div className="relative">
                    <span className="absolute -left-[31px] top-1 w-4 h-4 bg-yellow-500 rounded-full ring-4 ring-slate-950"></span>
                    <h3 className="font-black text-yellow-400 text-lg mb-1">Q4 2027: PancakeSwap Launch</h3>
                    <p className="text-gray-400 text-xs leading-relaxed">
                      Initial DEX Offering (IDO) on PancakeSwap. Locking Liquidity Pool for secure trading.
                    </p>
                  </div>
                  <div className="relative">
                    <span className="absolute -left-[31px] top-1 w-4 h-4 bg-orange-500 rounded-full ring-4 ring-slate-950"></span>
                    <h3 className="font-black text-orange-400 text-lg mb-1">Q1 2028: Snapshot & Airdrop</h3>
                    <p className="text-gray-400 text-xs leading-relaxed">
                      Final snapshot of miner accounts. Official Token Generation Event (TGE) and Airdrop to wallets.
                    </p>
                  </div>
                </div>
             </div>
          )}

          {discoverView === 'whitepaper' && (
             <div className="px-6 pt-6 w-full">
                <h1 className="text-2xl font-black text-transparent bg-clip-text bg-gradient-to-r from-yellow-400 to-orange-500 text-center uppercase tracking-widest mb-6">Whitepaper v2.0 (BSC)</h1>

                <h2 className="text-lg font-bold text-white border-b border-slate-700 pb-2 mb-4">1. Points vs. Tokens System</h2>
                <div className="bg-slate-900/50 p-4 rounded-xl border border-yellow-700/50 mb-6">
                  <ul className="text-xs text-gray-400 space-y-2 ml-4 list-disc">
                    <li><strong className="text-yellow-400">APXN Points:</strong> Virtual off-chain mining rewards inside Telegram.</li>
                    <li><strong className="text-yellow-400">APXN Token:</strong> The strictly limited BEP-20 on-chain token (100M).</li>
                  </ul>
                </div>

                <h2 className="text-lg font-bold text-white border-b border-slate-700 pb-2 mb-4">2. Technical Details</h2>
                <ul className="text-gray-300 text-xs mb-6 space-y-2 bg-slate-900/50 p-4 rounded-xl border border-slate-800">
                  <li><strong className="text-yellow-500">Name:</strong> Apex Network</li>
                  <li><strong className="text-yellow-500">Ticker:</strong> APXN</li>
                  <li><strong className="text-yellow-500">Blockchain:</strong> Binance Smart Chain (BEP-20)</li>
                  <li><strong className="text-yellow-500">Total Supply:</strong> 100,000,000 APXN <span className="text-green-500 font-bold">(Fixed/No Mint)</span></li>
                  <li><strong className="text-yellow-500">DEX:</strong> PancakeSwap</li>
                </ul>

                <h2 className="text-lg font-bold text-white border-b border-slate-700 pb-2 mb-4">3. Tokenomics</h2>
                <div className="space-y-3 mb-8">
                  <div className="bg-slate-900/80 p-3 rounded-xl border border-slate-800 flex items-center justify-between">
                    <span className="font-bold text-white text-xs">Community & Airdrop</span>
                    <span className="bg-blue-600 text-white px-2 py-1 rounded text-[10px] font-black">63%</span>
                  </div>
                  <div className="bg-slate-900/80 p-3 rounded-xl border border-slate-800 flex items-center justify-between">
                    <span className="font-bold text-white text-xs">PancakeSwap Liquidity</span>
                    <span className="bg-purple-600 text-white px-2 py-1 rounded text-[10px] font-black">20%</span>
                  </div>
                  <div className="bg-slate-900/80 p-3 rounded-xl border border-slate-800 flex items-center justify-between">
                    <span className="font-bold text-white text-xs">Marketing & Partners</span>
                    <span className="bg-green-600 text-white px-2 py-1 rounded text-[10px] font-black">10%</span>
                  </div>
                  <div className="bg-slate-900/80 p-3 rounded-xl border border-slate-800 flex items-center justify-between">
                    <span className="font-bold text-white text-xs">Core Team</span>
                    <span className="bg-orange-600 text-white px-2 py-1 rounded text-[10px] font-black">6%</span>
                  </div>
                  <div className="bg-slate-900/80 p-3 rounded-xl border border-slate-800 flex items-center justify-between">
                    <span className="font-bold text-white text-xs">Presale / ICO</span>
                    <span className="bg-red-600 text-white px-2 py-1 rounded text-[10px] font-black">1%</span>
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
