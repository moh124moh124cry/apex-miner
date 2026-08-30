"use client";
import { useState, useEffect } from 'react';
import { TonConnectButton, useTonAddress, useTonConnectUI } from '@tonconnect/ui-react';
import { supabase } from '../lib/supabase'; 

export default function Home() {
  const [balance, setBalance] = useState(0); 
  const [miningDelta, setMiningDelta] = useState(0);
  const [activeTab, setActiveTab] = useState('mine');
  const [taskCompleted, setTaskCompleted] = useState(false);
  const [friendsCount, setFriendsCount] = useState(0); 
  const [miningRate, setMiningRate] = useState(0.0001); 
  
  const [userId, setUserId] = useState(null);
  const [firstName, setFirstName] = useState('');
  const [userName, setUserName] = useState('');
  const [startParam, setStartParam] = useState(null);
  const [dbStatus, setDbStatus] = useState('Connecting...'); 

  const userAddress = useTonAddress();
  const [tonConnectUI] = useTonConnectUI(); 

  const ADMIN_WALLET = "UQAlWRIbr0ePdYPuc5kV0nEN4gPhLRnqASKWjaCeGPbinBwq"; 

  useEffect(() => {
    let attempts = 0;
    const getTelegramUser = () => {
      if (typeof window !== 'undefined' && window.Telegram?.WebApp) {
        window.Telegram.WebApp.ready();
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
        const { data, error } = await supabase.from('users').select('*').eq('telegram_id', userId).single();
        if (data) {
          setBalance(Number(data.balance || 0));
          if (data.mining_rate) setMiningRate(Number(data.mining_rate)); 
          setDbStatus('Data Loaded ✅');
          
          if (data.username !== userName || data.first_name !== firstName) {
            await supabase.from('users').update({ first_name: firstName, username: userName }).eq('telegram_id', userId);
          }
        } else if (error && error.code === 'PGRST116') {
          let initialBalance = 0;
          let referrerId = (startParam && startParam !== userId) ? startParam : null;
          if (referrerId) initialBalance = 10;
          const { error: insertError } = await supabase.from('users').insert([{ 
              telegram_id: userId, first_name: firstName, username: userName,
              balance: initialBalance, mining_rate: 0.0001, referred_by: referrerId
          }]);
          if (!insertError) {
            setDbStatus('New User Saved ✅');
            if (referrerId) {
              const { data: refData } = await supabase.from('users').select('balance').eq('telegram_id', referrerId).single();
              if (refData) await supabase.from('users').update({ balance: Number(refData.balance) + 10 }).eq('telegram_id', referrerId);
            }
          }
        }
        const { count } = await supabase.from('users').select('*', { count: 'exact', head: true }).eq('referred_by', userId);
        setFriendsCount(count || 0);
      } catch (err) {
        setDbStatus('Sys Error');
      }
    }
    if (firstName || userName) fetchUserData();
  }, [userId, firstName, userName, startParam]);

  useEffect(() => {
    const interval = setInterval(() => {
      setMiningDelta(prev => prev + miningRate);
    }, 1000);
    return () => clearInterval(interval);
  }, [miningRate]);

  const handleClaim = async () => {
    const newTotalBalance = balance + miningDelta;
    setBalance(newTotalBalance);
    setMiningDelta(0);
    if (userId && userId !== 'test_user') {
      setDbStatus('Saving...');
      const { error } = await supabase.from('users').update({ balance: newTotalBalance }).eq('telegram_id', userId);
      if (error) setDbStatus('Save Error');
      else setDbStatus('Saved ✅');
    }
  };

  const handleJoinChannel = async () => {
    if (taskCompleted) return;
    window.open('https://t.me/ApexMiner_Official', '_blank'); 
    const newBalance = balance + 5;
    setBalance(newBalance);
    setTaskCompleted(true);
    if (userId && userId !== 'test_user') {
      await supabase.from('users').update({ balance: newBalance }).eq('telegram_id', userId);
    }
  };

  const handleInviteFriend = () => {
    const inviteLink = `https://t.me/ApxMinerBot/app?startapp=${userId}`;
    const shareText = "🚀 Come mine APX with me for free on Telegram! Get a 10 APX welcome bonus:";
    window.open(`https://t.me/share/url?url=${encodeURIComponent(inviteLink)}&text=${encodeURIComponent(shareText)}`, '_blank');
  };

  const handleCopyLink = () => {
    navigator.clipboard.writeText(`https://t.me/ApxMinerBot/app?startapp=${userId}`);
    alert("✅ Invite link copied!");
  };

  const buyUpgrade = async (costType, costValue, newRateSpeed) => {
    if (miningRate >= newRateSpeed) {
      alert("✅ You already own this or a better upgrade!");
      return;
    }

    if (costType === 'APX') {
      if (balance >= costValue) {
        const newBalance = balance - costValue;
        setBalance(newBalance);
        setMiningRate(newRateSpeed);
        if (userId && userId !== 'test_user') {
          await supabase.from('users').update({ balance: newBalance, mining_rate: newRateSpeed }).eq('telegram_id', userId);
        }
        alert("✅ Upgrade purchased successfully with APX!");
      } else {
        alert("❌ Not enough APX balance!");
      }
    } 
    else if (costType === 'TON') {
      if (!userAddress) {
        alert("❌ Please connect your wallet first!");
        return;
      }
      const amountInNanoTON = (costValue * 1000000000).toString(); 
      const transaction = {
        validUntil: Math.floor(Date.now() / 1000) + 300, 
        messages: [{ address: ADMIN_WALLET, amount: amountInNanoTON }]
      };
      try {
        setDbStatus('Awaiting Payment...');
        const result = await tonConnectUI.sendTransaction(transaction);
        if (result) {
          setMiningRate(newRateSpeed);
          if (userId && userId !== 'test_user') {
            await supabase.from('users').update({ mining_rate: newRateSpeed }).eq('telegram_id', userId);
          }
          alert("✅ Premium Upgrade activated!");
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
        <span className="text-xl font-black text-transparent bg-clip-text bg-gradient-to-r from-blue-400 to-purple-500">APEX</span>
        <TonConnectButton />
      </div>

      {activeTab === 'mine' && (
        <div className="flex-1 w-full flex flex-col items-center px-6">
          <div className="w-full text-center mt-2">
            <h1 className="text-gray-400 text-xs tracking-widest uppercase mb-2">Total Balance</h1>
            <h2 className="text-4xl font-bold text-white">
              {balance.toFixed(4)} <span className="text-xl text-purple-400">APX</span>
            </h2>
          </div>

          <div className="w-full flex flex-col gap-3 mt-6">
            <div className="bg-slate-900/60 border border-slate-800 rounded-2xl p-4 flex justify-between items-center">
               <span className="text-gray-400 text-sm font-medium">MINING SPEED</span>
               <span className="font-semibold text-blue-400 text-xs">+{miningRate} APX/sec</span>
            </div>
          </div>

          <div className="mt-8 text-center">
             <h3 className="text-5xl font-black text-blue-400 drop-shadow-[0_0_15px_rgba(96,165,250,0.6)] tabular-nums">
               +{miningDelta.toFixed(4)}
             </h3>
          </div>

          <div className="flex-1 flex items-center justify-center my-8 relative w-full">
            <div className="absolute inset-0 bg-blue-500 blur-[80px] opacity-20 rounded-full"></div>
            <div className="w-48 h-48 rounded-full bg-gradient-to-br from-blue-700 to-purple-900 border-4 border-slate-700 flex items-center justify-center shadow-[0_0_40px_rgba(139,92,246,0.4)] z-10">
               <span className="text-6xl font-black tracking-tighter text-white drop-shadow-md">APX</span>
            </div>
          </div>
          <button onClick={handleClaim} className="w-full py-4 mt-auto mb-2 rounded-2xl bg-gradient-to-r from-blue-600 to-purple-600 text-lg font-bold shadow-[0_4px_20px_rgba(79,70,229,0.4)] active:scale-95 transition-all">
            CLAIM APEX
          </button>
        </div>
      )}

      {activeTab === 'tasks' && (
        <div className="flex-1 w-full flex flex-col px-6 pt-4">
          <h2 className="text-2xl font-bold text-white mb-6">Earn More APX</h2>
          <div className="bg-slate-900/80 border border-slate-800 rounded-2xl p-4 flex items-center justify-between mb-4">
            <div>
              <h3 className="font-bold text-white text-lg">Join Telegram Channel</h3>
              <p className="text-gray-400 text-xs">+5 APX Reward</p>
            </div>
            <button onClick={handleJoinChannel} disabled={taskCompleted} className={`${taskCompleted ? 'bg-green-600' : 'bg-blue-600'} px-4 py-2 rounded-xl text-sm font-bold active:scale-95 transition-colors`}>
              {taskCompleted ? 'Done ✓' : 'GO'}
            </button>
          </div>
        </div>
      )}

      {activeTab === 'friends' && (
        <div className="flex-1 w-full flex flex-col px-6 pt-4">
          <div className="text-center mb-8 mt-4">
             <h2 className="text-3xl font-bold text-white mb-2">Invite Friends!</h2>
             <p className="text-gray-400 text-sm">Get <span className="text-blue-400 font-bold">10 APX</span> for each friend</p>
          </div>
          <div className="bg-slate-900/80 border border-slate-800 rounded-2xl p-6 text-center flex flex-col gap-4">
             <h3 className="text-6xl mb-2">🎁</h3>
             <h4 className="text-white font-bold text-lg">Your Friends: {friendsCount}</h4>
             <button onClick={handleInviteFriend} className="w-full bg-blue-600 py-3 rounded-xl text-white font-bold text-lg shadow-[0_4px_20px_rgba(37,99,235,0.4)] active:scale-95 transition-all">
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
          <p className="text-gray-400 text-xs mb-6">Upgrade your hardware to mine APX faster!</p>
          <div className="flex flex-col gap-4">
            <div className="bg-slate-900/80 border border-slate-800 rounded-2xl p-4 flex flex-col gap-3">
              <div className="flex justify-between items-center">
                <div>
                  <h3 className="font-bold text-white text-lg">GPU Overclock</h3>
                  <p className="text-blue-400 text-sm font-bold">Speed: 0.0005 APX/sec</p>
                </div>
                <span className="text-2xl">⚙️</span>
              </div>
              <button onClick={() => buyUpgrade('APX', 500, 0.0005)} disabled={miningRate >= 0.0005} className={`w-full py-2 rounded-xl text-sm font-bold active:scale-95 transition-colors ${miningRate >= 0.0005 ? 'bg-slate-700 text-gray-400' : 'bg-slate-800 text-white border border-slate-700'}`}>
                {miningRate >= 0.0005 ? 'Owned ✓' : 'Pay 500 APX'}
              </button>
            </div>
            <div className="bg-slate-900/80 border border-slate-800 rounded-2xl p-4 flex flex-col gap-3">
              <div className="flex justify-between items-center">
                <div>
                  <h3 className="font-bold text-white text-lg">Cloud Server Rig</h3>
                  <p className="text-purple-400 text-sm font-bold">Speed: 0.0015 APX/sec</p>
                </div>
                <span className="text-2xl">☁️</span>
              </div>
              <button onClick={() => buyUpgrade('TON', 0.15, 0.0015)} disabled={miningRate >= 0.0015} className={`w-full py-2 rounded-xl text-sm font-bold active:scale-95 transition-colors ${miningRate >= 0.0015 ? 'bg-slate-700 text-gray-400' : 'bg-gradient-to-r from-blue-600 to-purple-600 text-white'}`}>
                {miningRate >= 0.0015 ? 'Owned ✓' : 'Buy for 0.15 TON'}
              </button>
            </div>
            <div className="bg-slate-900/80 border border-yellow-900/30 rounded-2xl p-4 flex flex-col gap-3">
              <div className="flex justify-between items-center">
                <div>
                  <h3 className="font-bold text-yellow-500 text-lg">Quantum ASIC</h3>
                  <p className="text-yellow-400 text-sm font-bold">Speed: 0.0050 APX/sec</p>
                </div>
                <span className="text-2xl">🚀</span>
              </div>
              <button onClick={() => buyUpgrade('TON', 0.50, 0.0050)} disabled={miningRate >= 0.0050} className={`w-full py-2 rounded-xl text-sm font-bold active:scale-95 transition-colors ${miningRate >= 0.0050 ? 'bg-slate-700 text-gray-400' : 'bg-gradient-to-r from-yellow-600 to-orange-500 text-white'}`}>
                {miningRate >= 0.0050 ? 'Owned ✓' : 'Buy for 0.50 TON'}
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="fixed bottom-0 left-0 w-full bg-slate-950/95 backdrop-blur-xl border-t border-slate-800 p-3 flex justify-around items-center z-50">
        <button onClick={() => setActiveTab('mine')} className={`flex flex-col items-center gap-1 w-1/4 ${activeTab === 'mine' ? 'text-blue-400 scale-110 transition-transform' : 'text-gray-500'}`}>
          <span className="text-xl">⛏️</span><span className="text-[9px] font-bold">Mine</span>
        </button>
        <button onClick={() => setActiveTab('tasks')} className={`flex flex-col items-center gap-1 w-1/4 ${activeTab === 'tasks' ? 'text-blue-400 scale-110 transition-transform' : 'text-gray-500'}`}>
          <span className="text-xl">📋</span><span className="text-[9px] font-bold">Tasks</span>
        </button>
        <button onClick={() => setActiveTab('friends')} className={`flex flex-col items-center gap-1 w-1/4 ${activeTab === 'friends' ? 'text-blue-400 scale-110 transition-transform' : 'text-gray-500'}`}>
          <span className="text-xl">👥</span><span className="text-[9px] font-bold">Friends</span>
        </button>
        <button onClick={() => setActiveTab('boosts')} className={`flex flex-col items-center gap-1 w-1/4 ${activeTab === 'boosts' ? 'text-purple-400 scale-110 transition-transform' : 'text-gray-500'}`}>
          <span className="text-xl">🚀</span><span className="text-[9px] font-bold">Boosts</span>
        </button>
      </div>
    </main>
  );
}
