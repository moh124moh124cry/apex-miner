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
          if (data.channel_joined) setTaskCompleted(data.channel_joined); 
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
              balance: initialBalance, mining_rate: 0.0001, referred_by: referrerId, channel_joined: false
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
      await supabase.from('users').update({ balance: newBalance, channel_joined: true }).eq('telegram_id', userId);
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
        {/* تعديل مسار الصورة إلى logo2.png */}
        <div className="flex items-center gap-2">
          <Image src="/logo2.png" alt="Apex Logo" width={28} height={28} className="rounded-full shadow-[0_0_10px_rgba(96,165,250,0.5)]" />
          <span className="text-xl font-black text-transparent bg-clip-text bg-gradient-to-r from-blue-400 to-purple-500">APEX</span>
        </div>
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
            {/* تعديل مسار الصورة إلى logo2.png */}
            <div className="w-48 h-48 rounded-full bg-gradient-to-br from-blue-700 to-purple-900 border-4 border-slate-700 flex items-center justify-center shadow-[0_0_40px_rgba(139,92,246,0.4)] z-10 overflow-hidden">
               <Image src="/logo2.png" alt="Apex Coin" width={140} height={140} className="object-contain drop-shadow-[0_0_15px_rgba(255,255,255,0.3)] hover:scale-105 transition-transform duration-300" />
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

      {activeTab === 'whitepaper' && (
        <div className="flex-1 w-full flex flex-col px-6 pt-6 overflow-y-auto text-left pb-10">
          <h1 className="text-3xl font-black text-transparent bg-clip-text bg-gradient-to-r from-blue-400 to-purple-500 text-center uppercase tracking-widest mb-1">ApexMiner</h1>
          <p className="text-gray-400 text-xs text-center mb-8">Official Whitepaper & Roadmap v1.0</p>

          <h2 className="text-xl font-bold text-white border-b border-slate-700 pb-2 mb-4">1. Introduction</h2>
          <p className="text-gray-300 text-sm mb-6 leading-relaxed">
            <strong>ApexMiner</strong> is an interactive Telegram-based Mini-App built on the <strong>TON (The Open Network)</strong> blockchain. It is designed to cultivate a robust, engaged decentralized community. The project focuses on rewarding early adopters through mining mechanics, gamification, and social tasks, culminating in a highly anticipated Token Generation Event (TGE).
          </p>

          <h2 className="text-xl font-bold text-white border-b border-slate-700 pb-2 mb-4">2. Technical Token Details</h2>
          <ul className="text-gray-300 text-sm mb-6 space-y-2 bg-slate-900/50 p-4 rounded-xl border border-slate-800">
            <li><strong className="text-blue-400">Token Name:</strong> Apex</li>
            <li><strong className="text-blue-400">Ticker Symbol:</strong> APX</li>
            <li><strong className="text-blue-400">Blockchain:</strong> The Open Network (TON)</li>
            <li><strong className="text-blue-400">Total Supply:</strong> 1,000,000,000 APX <span className="text-yellow-500 font-bold">(Fixed)</span></li>
            <li><strong className="text-blue-400">Decimals:</strong> 9</li>
            <li><strong className="text-blue-400">Smart Contract:</strong> Will be publicly revealed right before the TGE in late 2028 to ensure liquidity protection.</li>
          </ul>

          <h2 className="text-xl font-bold text-white border-b border-slate-700 pb-2 mb-4">3. Tokenomics & Allocation</h2>
          <div className="space-y-4 mb-8">
            <div className="bg-slate-900/80 p-4 rounded-xl border border-slate-800">
              <h3 className="font-bold text-white mb-1"><span className="bg-blue-600 text-white px-2 py-0.5 rounded text-xs mr-2">63%</span>Community, Mining & Airdrop</h3>
              <p className="text-gray-400 text-xs">630,000,000 APX - Distributed to players via the Mini-App through daily mining, referrals, and tournaments.</p>
            </div>
            <div className="bg-slate-900/80 p-4 rounded-xl border border-slate-800">
              <h3 className="font-bold text-white mb-1"><span className="bg-purple-600 text-white px-2 py-0.5 rounded text-xs mr-2">20%</span>Liquidity & Exchanges</h3>
              <p className="text-gray-400 text-xs">200,000,000 APX - Allocated to provide necessary liquidity for DEXs (e.g., STON.fi) and CEXs upon listing.</p>
            </div>
            <div className="bg-slate-900/80 p-4 rounded-xl border border-slate-800">
              <h3 className="font-bold text-white mb-1"><span className="bg-green-600 text-white px-2 py-0.5 rounded text-xs mr-2">10%</span>Marketing & Partnerships</h3>
              <p className="text-gray-400 text-xs">100,000,000 APX - Used to fund campaigns, influencers, and alliances within the TON ecosystem.</p>
            </div>
            <div className="bg-slate-900/80 p-4 rounded-xl border border-slate-800">
              <h3 className="font-bold text-white mb-1"><span className="bg-orange-600 text-white px-2 py-0.5 rounded text-xs mr-2">5%</span>Core Team & Founders</h3>
              <p className="text-gray-400 text-xs">50,000,000 APX - Allocated to fund infrastructure, servers, and long-term project management.</p>
            </div>
            <div className="bg-slate-900/80 p-4 rounded-xl border border-slate-800">
              <h3 className="font-bold text-white mb-1"><span className="bg-red-600 text-white px-2 py-0.5 rounded text-xs mr-2">2%</span>Presale / ICO</h3>
              <p className="text-gray-400 text-xs">20,000,000 APX - Limited allocation for early investors. The team reserves the right to cancel this phase entirely.</p>
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
                <li>Official launch of the ApexMiner Mini-App.</li>
                <li>Activation of core mining, referrals, and Boosts.</li>
              </ul>
            </div>
            <div>
              <div className="flex items-center gap-2 mb-1">
                <div className="w-3 h-3 bg-purple-500 rounded-full -ml-[23px] ring-4 ring-slate-950"></div>
                <h3 className="font-bold text-purple-400">H1 2027: Gamification</h3>
              </div>
              <ul className="text-gray-400 text-xs list-disc ml-4 space-y-1">
                <li>Launch of Leaderboard and weekly rewards.</li>
                <li>Introduction of "Squads" for group mining.</li>
                <li><strong>First Halving:</strong> Base speed cut in half.</li>
              </ul>
            </div>
            <div>
              <div className="flex items-center gap-2 mb-1">
                <div className="w-3 h-3 bg-green-500 rounded-full -ml-[23px] ring-4 ring-slate-950"></div>
                <h3 className="font-bold text-green-400">H2 2027: Ecosystem</h3>
              </div>
              <ul className="text-gray-400 text-xs list-disc ml-4 space-y-1">
                <li>Integration of Mini-Games for engagement.</li>
                <li>Opening B2B advertising tasks.</li>
              </ul>
            </div>
            <div>
              <div className="flex items-center gap-2 mb-1">
                <div className="w-3 h-3 bg-yellow-500 rounded-full -ml-[23px] ring-4 ring-slate-950"></div>
                <h3 className="font-bold text-yellow-400">2028: Preparation</h3>
              </div>
              <ul className="text-gray-400 text-xs list-disc ml-4 space-y-1">
                <li>Activation of APX Staking.</li>
                <li>Converting advanced Boosts into tradable NFTs.</li>
                <li><strong>Second Halving</strong> and Bot sweeping.</li>
                <li><strong>Q4 2028:</strong> Closure of mining pools & Final Snapshot.</li>
              </ul>
            </div>
            <div>
              <div className="flex items-center gap-2 mb-1">
                <div className="w-3 h-3 bg-red-500 rounded-full -ml-[23px] ring-4 ring-slate-950"></div>
                <h3 className="font-bold text-red-400">Q1 2029: TGE & Listing</h3>
              </div>
              <ul className="text-gray-400 text-xs list-disc ml-4 space-y-1">
                <li>TGE and Airdrop distribution to Tonkeeper wallets.</li>
                <li>Official listing of APX on public exchanges.</li>
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

      <div className="fixed bottom-0 left-0 w-full bg-slate-950/95 backdrop-blur-xl border-t border-slate-800 p-3 flex justify-around items-center z-50">
        <button onClick={() => setActiveTab('mine')} className={`flex flex-col items-center gap-1 w-1/5 ${activeTab === 'mine' ? 'text-blue-400 scale-110 transition-transform' : 'text-gray-500'}`}>
          <span className="text-xl">⛏️</span><span className="text-[9px] font-bold">Mine</span>
        </button>
        <button onClick={() => setActiveTab('tasks')} className={`flex flex-col items-center gap-1 w-1/5 ${activeTab === 'tasks' ? 'text-blue-400 scale-110 transition-transform' : 'text-gray-500'}`}>
          <span className="text-xl">📋</span><span className="text-[9px] font-bold">Tasks</span>
        </button>
        <button onClick={() => setActiveTab('friends')} className={`flex flex-col items-center gap-1 w-1/5 ${activeTab === 'friends' ? 'text-blue-400 scale-110 transition-transform' : 'text-gray-500'}`}>
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
