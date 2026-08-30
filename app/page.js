"use client";
import { useState, useEffect } from 'react';
import { TonConnectButton, useTonAddress } from '@tonconnect/ui-react';
// استدعاء ملف الاتصال بقاعدة البيانات الذي أنشأته للتو
import { supabase } from '../lib/supabase';

export default function Home() {
  const [balance, setBalance] = useState(0);
  const [miningDelta, setMiningDelta] = useState(0);
  const [activeTab, setActiveTab] = useState('mine');
  const [taskCompleted, setTaskCompleted] = useState(false);
  const [friendsCount, setFriendsCount] = useState(0); 
  const [miningRate, setMiningRate] = useState(0.0001);
  const [boostActive, setBoostActive] = useState(false);
  const [userId, setUserId] = useState(null);

  const userAddress = useTonAddress();

  // 1. جلب معرف المستخدم الحقيقي من تليجرام
  useEffect(() => {
    if (typeof window !== 'undefined' && window.Telegram?.WebApp?.initDataUnsafe?.user?.id) {
      setUserId(window.Telegram.WebApp.initDataUnsafe.user.id.toString());
    } else {
      // معرف تجريبي في حال فتحت التطبيق من المتصفح العادي للبرمجة
      setUserId('test_user_123');
    }
  }, []);

  // 2. جلب رصيد المستخدم من قاعدة البيانات السحابية
  useEffect(() => {
    async function fetchUserData() {
      if (!userId) return;

      const { data, error } = await supabase
        .from('users')
        .select('*')
        .eq('telegram_id', userId)
        .single();

      if (data) {
        setBalance(parseFloat(data.balance || 0));
        setBoostActive(data.boost_active || false);
        if (data.boost_active) setMiningRate(0.0002);
      } else {
        // إذا كان المستخدم جديداً، ننشئ له حساباً برصيد 0
        await supabase
          .from('users')
          .insert([{ telegram_id: userId, balance: 0, boost_active: false }]);
      }
    }

    fetchUserData();
  }, [userId]);

  // 3. عداد التعدين الحي
  useEffect(() => {
    const interval = setInterval(() => {
      setMiningDelta(prev => prev + miningRate);
    }, 1000);
    return () => clearInterval(interval);
  }, [miningRate]);

  // 4. حفظ الرصيد في السحابة عند الضغط على Claim
  const handleClaim = async () => {
    const newTotalBalance = balance + miningDelta;
    setBalance(newTotalBalance);
    setMiningDelta(0);

    // الحفظ المباشر في Supabase
    await supabase
      .from('users')
      .update({ balance: newTotalBalance })
      .eq('telegram_id', userId);
  };

  // نظام المهام
  const handleJoinChannel = async () => {
    if (taskCompleted) return;
    window.open('https://t.me/ApexMiner_Official', '_blank');
    
    const newBalance = balance + 5;
    setBalance(newBalance);
    setTaskCompleted(true);

    await supabase
      .from('users')
      .update({ balance: newBalance })
      .eq('telegram_id', userId);
  };

  // نظام الإحالة
  const handleInviteFriend = () => {
    const inviteLink = `https://t.me/ApxMinerBot/app?startapp=${userId}`;
    const shareText = "🚀 Come mine APX with me for free on Telegram! Get a 10 APX welcome bonus when you join through my link:";
    const fullUrl = `https://t.me/share/url?url=${encodeURIComponent(inviteLink)}&text=${encodeURIComponent(shareText)}`;
    window.open(fullUrl, '_blank');
  };

  const handleCopyLink = () => {
    const inviteLink = `https://t.me/ApxMinerBot/app?startapp=${userId}`;
    navigator.clipboard.writeText(inviteLink);
    alert("✅ Invite link copied! Send it to your friends now.");
  };

  // نظام شراء الترقيات
  const handleBuyBoost = async () => {
    if (boostActive) return;
    
    const boostCost = 50;
    if (balance >= boostCost) {
      const newBalance = balance - boostCost;
      setBalance(newBalance);
      setBoostActive(true);
      setMiningRate(0.0002);
      
      await supabase
        .from('users')
        .update({ balance: newBalance, boost_active: true })
        .eq('telegram_id', userId);
    } else {
      alert("❌ Not enough APX balance! Claim more from mining first.");
    }
  };

  return (
    <main className="flex min-h-screen flex-col items-center bg-slate-950 font-sans overflow-hidden relative pb-24">
      
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
               <span className="text-gray-400 text-sm font-medium">WALLET</span>
               <span className="font-semibold text-gray-200 text-xs">
                 {userAddress ? `${userAddress.slice(0, 4)}...${userAddress.slice(-4)}` : 'Not Connected'}
               </span>
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

          <button 
            onClick={handleClaim}
            className="w-full py-4 mt-auto mb-2 rounded-2xl bg-gradient-to-r from-blue-600 to-purple-600 text-lg font-bold shadow-[0_4px_20px_rgba(79,70,229,0.4)] active:scale-95 transition-all"
          >
            CLAIM APEX
          </button>
        </div>
      )}

      {activeTab === 'tasks' && (
        <div className="flex-1 w-full flex flex-col px-6 pt-4">
          <h2 className="text-2xl font-bold text-white mb-6">Earn More APX</h2>
          <div className="bg-slate-900/80 border border-slate-800 rounded-2xl p-4 flex items-center justify-between">
            <div>
              <h3 className="font-bold text-white text-lg">Join Telegram Channel</h3>
              <p className="text-gray-400 text-xs">+5 APX Reward</p>
            </div>
            <button 
              onClick={handleJoinChannel}
              disabled={taskCompleted}
              className={`${taskCompleted ? 'bg-green-600' : 'bg-blue-600'} px-4 py-2 rounded-xl text-sm font-bold active:scale-95 transition-colors`}
            >
              {taskCompleted ? 'Completed ✓' : 'GO'}
            </button>
          </div>
        </div>
      )}

      {activeTab === 'friends' && (
        <div className="flex-1 w-full flex flex-col px-6 pt-4">
          <div className="text-center mb-8 mt-4">
             <h2 className="text-3xl font-bold text-white mb-2">Invite Friends!</h2>
             <p className="text-gray-400 text-sm">You and your friend will receive <span className="text-blue-400 font-bold">10 APX</span></p>
          </div>

          <div className="bg-slate-900/80 border border-slate-800 rounded-2xl p-6 text-center flex flex-col gap-4">
             <h3 className="text-6xl mb-2">🎁</h3>
             <h4 className="text-white font-bold text-lg">Your Friends: {friendsCount}</h4>
             <button 
               onClick={handleInviteFriend}
               className="w-full bg-blue-600 py-3 rounded-xl text-white font-bold text-lg shadow-[0_4px_20px_rgba(37,99,235,0.4)] active:scale-95 transition-all"
             >
               Invite a Friend
             </button>
             <button 
               onClick={handleCopyLink}
               className="w-full bg-slate-800 py-3 rounded-xl text-gray-300 font-bold active:scale-95 transition-all"
             >
               Copy Invite Link
             </button>
          </div>
        </div>
      )}

      {activeTab === 'boosts' && (
        <div className="flex-1 w-full flex flex-col px-6 pt-4">
          <h2 className="text-2xl font-bold text-white mb-6">Mining Boosts</h2>
          <div className="bg-slate-900/80 border border-slate-800 rounded-2xl p-4 flex items-center justify-between">
            <div>
              <h3 className="font-bold text-white text-lg">Speed Reactor</h3>
              <p className="text-gray-400 text-xs">Increase mining speed by 2x</p>
            </div>
            <button 
              onClick={handleBuyBoost}
              disabled={boostActive}
              className={`${boostActive ? 'bg-green-600' : 'bg-blue-600'} px-4 py-2 rounded-xl text-sm font-bold active:scale-95 transition-colors`}
            >
              {boostActive ? 'Active ✓' : '50 APX'}
            </button>
          </div>
        </div>
      )}

      <div className="fixed bottom-0 left-0 w-full bg-slate-950/90 backdrop-blur-md border-t border-slate-800 p-4 flex justify-between items-center z-50 px-6">
        <button onClick={() => setActiveTab('mine')} className={`flex flex-col items-center gap-1 ${activeTab === 'mine' ? 'text-blue-400' : 'text-gray-500'}`}>
          <span className="text-2xl">⛏️</span><span className="text-[10px] font-bold">Mine</span>
        </button>
        <button onClick={() => setActiveTab('tasks')} className={`flex flex-col items-center gap-1 ${activeTab === 'tasks' ? 'text-blue-400' : 'text-gray-500'}`}>
          <span className="text-2xl">📋</span><span className="text-[10px] font-bold">Tasks</span>
        </button>
        <button onClick={() => setActiveTab('friends')} className={`flex flex-col items-center gap-1 ${activeTab === 'friends' ? 'text-blue-400' : 'text-gray-500'}`}>
          <span className="text-2xl">👥</span><span className="text-[10px] font-bold">Friends</span>
        </button>
        <button onClick={() => setActiveTab('boosts')} className={`flex flex-col items-center gap-1 ${activeTab === 'boosts' ? 'text-purple-400' : 'text-gray-500'}`}>
          <span className="text-2xl">🚀</span><span className="text-[10px] font-bold">Boosts</span>
        </button>
      </div>
    </main>
  );
}

