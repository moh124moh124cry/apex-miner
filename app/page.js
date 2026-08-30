"use client";
import { useState, useEffect } from 'react';
import { TonConnectButton, useTonAddress } from '@tonconnect/ui-react';

export default function Home() {
  const [balance, setBalance] = useState(0);
  const [miningDelta, setMiningDelta] = useState(0);
  const [activeTab, setActiveTab] = useState('mine');
  const [taskCompleted, setTaskCompleted] = useState(false);
  const userAddress = useTonAddress();

  // 1. استرجاع البيانات المحفوظة عند فتح التطبيق
  useEffect(() => {
    const savedBalance = localStorage.getItem('apex_balance');
    const savedDelta = localStorage.getItem('apex_delta');
    const savedTask = localStorage.getItem('apex_task_1');
    
    if (savedBalance) setBalance(parseFloat(savedBalance));
    if (savedDelta) setMiningDelta(parseFloat(savedDelta));
    if (savedTask === 'completed') setTaskCompleted(true);
  }, []);

  // 2. عداد التعدين والحفظ التلقائي لنقاط التعدين
  useEffect(() => {
    const interval = setInterval(() => {
      setMiningDelta(prev => {
        const newDelta = prev + 0.0001;
        localStorage.setItem('apex_delta', newDelta.toString());
        return newDelta;
      });
    }, 1000);
    return () => clearInterval(interval);
  }, []);

  // 3. حفظ الرصيد الإجمالي عند المطالبة (Claim)
  useEffect(() => {
    localStorage.setItem('apex_balance', balance.toString());
  }, [balance]);

  const handleClaim = () => {
     setBalance(prev => prev + miningDelta);
     setMiningDelta(0);
     localStorage.setItem('apex_delta', '0');
  };

  // 4. وظيفة مهمة الانضمام لقناة تليجرام
  const handleJoinChannel = () => {
    if (taskCompleted) return;
    
    // فتح القناة الرسمية
    window.open('https://t.me/ApexMiner_Official', '_blank');
    
    // إضافة المكافأة وتحديث الرصيد
    const newBalance = balance + 100;
    setBalance(newBalance);
    localStorage.setItem('apex_balance', newBalance.toString());
    
    // حفظ اكتمال المهمة
    setTaskCompleted(true);
    localStorage.setItem('apex_task_1', 'completed');
  };

  return (
    <main className="flex min-h-screen flex-col items-center bg-slate-950 font-sans overflow-hidden relative pb-24">
      
      {/* Header & Wallet */}
      <div className="w-full flex justify-between items-center p-4">
        <span className="text-xl font-black text-transparent bg-clip-text bg-gradient-to-r from-blue-400 to-purple-500">APEX</span>
        <TonConnectButton />
      </div>

      {/* Main Content Area - Mine */}
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

      {/* Boosts Tab */}
      {activeTab === 'boosts' && (
        <div className="flex-1 w-full flex flex-col px-6 pt-4">
          <h2 className="text-2xl font-bold text-white mb-6">Mining Boosts</h2>
          <div className="bg-slate-900/80 border border-slate-800 rounded-2xl p-4 flex items-center justify-between">
            <div>
              <h3 className="font-bold text-white text-lg">Speed Reactor</h3>
              <p className="text-gray-400 text-xs">Increase mining speed by 2x</p>
            </div>
            <button className="bg-blue-600 px-4 py-2 rounded-xl text-sm font-bold active:scale-95">500 APX</button>
          </div>
        </div>
      )}

      {/* Tasks Tab */}
      {activeTab === 'tasks' && (
        <div className="flex-1 w-full flex flex-col px-6 pt-4">
          <h2 className="text-2xl font-bold text-white mb-6">Earn More APX</h2>
          <div className="bg-slate-900/80 border border-slate-800 rounded-2xl p-4 flex items-center justify-between">
            <div>
              <h3 className="font-bold text-white text-lg">Join Telegram Channel</h3>
              <p className="text-gray-400 text-xs">+100 APX Reward</p>
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

      {/* Bottom Navigation Bar */}
      <div className="fixed bottom-0 left-0 w-full bg-slate-950/90 backdrop-blur-md border-t border-slate-800 p-4 flex justify-around items-center z-50">
        <button onClick={() => setActiveTab('mine')} className={`flex flex-col items-center gap-1 ${activeTab === 'mine' ? 'text-blue-400' : 'text-gray-500'}`}>
          <span className="text-2xl">⛏️</span><span className="text-xs font-bold">Mine</span>
        </button>
        <button onClick={() => setActiveTab('tasks')} className={`flex flex-col items-center gap-1 ${activeTab === 'tasks' ? 'text-blue-400' : 'text-gray-500'}`}>
          <span className="text-2xl">📋</span><span className="text-xs font-bold">Tasks</span>
        </button>
        <button onClick={() => setActiveTab('boosts')} className={`flex flex-col items-center gap-1 ${activeTab === 'boosts' ? 'text-purple-400' : 'text-gray-500'}`}>
          <span className="text-2xl">🚀</span><span className="text-xs font-bold">Boosts</span>
        </button>
      </div>
    </main>
  );
}
