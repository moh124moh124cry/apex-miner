"use client";
import { useState, useEffect } from 'react';
import { TonConnectButton, useTonAddress, useTonConnectUI } from '@tonconnect/ui-react';
import { supabase } from '../lib/supabase'; 
import Image from 'next/image';

export default function Home() {
  const [balance, setBalance] = useState(0); 
  const [miningDelta, setMiningDelta] = useState(0);
  const [activeTab, setActiveTab] = useState('mine');
  const [taskCompleted, setTaskCompleted] = useState(false);
  const [friendsCount, setFriendsCount] = useState(0); 
  const [activeFriendsCount, setActiveFriendsCount] = useState(0); 
  const [dbMiningRate, setDbMiningRate] = useState(0.00025); // السرعة الأساسية الجديدة المجانية
  const [totalMiningRate, setTotalMiningRate] = useState(0.00025); 
  
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

          const { count: totalCount } = await supabase.from('users').select('*', { count: 'exact', head: true }).eq('referred_by', userId);
          setFriendsCount(totalCount || 0);

          const yesterday = new Date(Date.now() - 86400000).toISOString();
          const { count: activeCount } = await supabase.from('users').select('*', { count: 'exact', head: true }).eq('referred_by', userId).gte('last_claim', yesterday);
          activeFriends = activeCount || 0;
          setActiveFriendsCount(activeFriends);

          const friendsBonus = activeFriends * (currentDbRate * 0.05);
          const finalRate = currentDbRate + friendsBonus;
          setTotalMiningRate(finalRate);
          
          if (data.last_claim) {
            const lastTime = new Date(data.last_claim).getTime();
            const now = new Date().getTime();
            const diffSeconds = (now - lastTime) / 1000;
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
              balance: initialBalance, mining_rate: 0.00025, referred_by: referrerId, channel_joined: false, last_claim: currentIsoTime
          }]);

          if (!insertError) {
            setDbStatus('New User Saved ✅');
            setTotalMiningRate(0.00025);
          } else {
            setDbStatus('Insert Error ❌');
            alert(`DB Insert Error: ${insertError.message}`);
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

  const handleClaim = async () => {
    const newTotalBalance = balance + miningDelta;
    const currentIsoTime = new Date().toISOString();
    setBalance(newTotalBalance);
    setMiningDelta(0);
    if (userId && userId !== 'test_user') {
      setDbStatus('Saving...');
      const { error } = await supabase.from('users').update({ balance: newTotalBalance, last_claim: currentIsoTime }).eq('telegram_id', userId);
      if (error) {
        setDbStatus('Save Error ❌');
        alert(`Error: ${error.message} - Please fix 'mining_rate' or 'last_claim' in Supabase.`);
      } else {
        setDbStatus('Saved ✅');
      }
    }
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
            alert(`❌ Database Error: ${error.message}. Fix Supabase schema.`);
            return;
          }
        }
        
        setBalance(newBalance);
        setMiningDelta(0);
        setDbMiningRate(newRateSpeed);
        setTotalMiningRate(newRateSpeed + (activeFriendsCount * (newRateSpeed * 0.05)));
        alert("✅ Upgrade purchased successfully with Points!");
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
          alert("✅ Payment Confirmed! Activating Speed...");

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
        {/* كلمة APEX والشعار في الأعلى باللون الأزرق الاحترافي */}
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
            {/* الدائرة الزرقاء للشعار */}
            <div className="absolute inset-0 bg-blue-500 blur-[80px] opacity-20 rounded-full"></div>
            <div className="w-48 h-48 rounded-full bg-gradient-to-br from-blue-700 to-purple-900 border-4 border-slate-700 flex items-center justify-center shadow-[0_0_40px_rgba(139,92,246,0.4)] z-10 overflow-hidden">
               <Image src="/logo2.png" alt="Apex Coin" width={140} height={140} className="object-contain drop-shadow-[0_0_15px_rgba(255,255,255,0.3)] hover:scale-105 transition-transform duration-300" />
            </div>
          </div>
          {/* زر التجميع الذهبي */}
          <button onClick={handleClaim} className="w-full py-4 mt-auto mb-2 rounded-2xl bg-gradient-to-r from-yellow-500 to-orange-600 text-lg font-bold text-white shadow-[0_4px_20px_rgba(245,158,11,0.4)] active:scale-95 transition-all">
            CLAIM POINTS
          </button>
        </div>
      )}

      {activeTab === 'tasks' && (
        <div className="flex-1 w-full flex flex-col px-6 pt-4">
          <h2 className="text-2xl font-bold text-white mb-6">Earn More Points</h2>
          <div className="bg-slate-900/80 border border-slate-800 rounded-2xl p-4 flex items-center justify-between mb-4">
            <div>
              <h3 className="font-bold text-white text-lg">Join Telegram Channel</h3>
              <p className="text-yellow-400 text-xs">+500 APEX Points</p>
            </div>
            <button onClick={handleJoinChannel} disabled={taskCompleted} className={`${taskCompleted ? 'bg-green-600' : 'bg-yellow-600'} px-4 py-2 rounded-xl text-white text-sm font-bold active:scale-95 transition-colors`}>
              {taskCompleted ? 'Done ✓' : 'GO'}
            </button>
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
            </div>
            <div className="bg-slate-900/80 p-4 rounded-xl border border-slate-800">
              <h3 className="font-bold text-white mb-1"><span className="bg-orange-600 text-white px-2 py-0.5 rounded text-xs mr-2">5%</span>Core Team & Founders</h3>
            </div>
          </div>
        </div>
      )}

      <div className="fixed bottom-0 left-0 w-full bg-slate-950/95 backdrop-blur-xl border-t border-slate-800 p-3 flex justify-around items-center z-50">
        <button onClick={() => setActiveTab('mine')} className={`flex flex-col items-center gap-1 w-1/5 ${activeTab === 'mine' ? 'text-yellow-400 scale-110 transition-transform' : 'text-gray-500'}`}>
          <span className="text-xl">⛏️</span><span className="text-[9px] font-bold">Mine</span>
        </button>
        <button onClick={() => setActiveTab('tasks')} className={`flex flex-col items-center gap-1 w-1/5 ${activeTab === 'tasks' ? 'text-yellow-400 scale-110 transition-transform' : 'text-gray-500'}`}>
          <span className="text-xl">📋</span><span className="text-[9px] font-bold">Earn</span>
        </button>
        <button onClick={() => setActiveTab('friends')} className={`flex flex-col items-center gap-1 w-1/5 ${activeTab === 'friends' ? 'text-yellow-400 scale-110 transition-transform' : 'text-gray-500'}`}>
          <span className="text-xl">👥</span><span className="text-[9px] font-bold">Friends</span>
        </button>
        <button onClick={() => setActiveTab('boosts')} className={`flex flex-col items-center gap-1 w-1/5 ${activeTab === 'boosts' ? 'text-purple-400 scale-110 transition-transform' : 'text-gray-500'}`}>
          <span className="text-xl">🚀</span><span className="text-[9px] font-bold">Boosts</span>
        </button>
        <button onClick={() => setActiveTab('whitepaper')} className={`flex flex-col items-center gap-1 w-1/5 ${activeTab === 'whitepaper' ? 'text-yellow-500 scale-110 transition-transform' : 'text-gray-500'}`}>
          <span className="text-xl">📄</span><span className="text-[9px] font-bold">Docs</span>
        </button>
      </div>
    </main>
  );
}
