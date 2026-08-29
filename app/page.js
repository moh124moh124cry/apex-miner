"use client";
import { useState, useEffect } from 'react';

export default function Home() {
  const [balance, setBalance] = useState(28.0000);
  const [miningDelta, setMiningDelta] = useState(0.0188);

  // محاكاة بسيطة لعداد التعدين
  useEffect(() => {
    const interval = setInterval(() => {
      setMiningDelta(prev => prev + 0.0001);
    }, 1000);
    return () => clearInterval(interval);
  }, []);

  const handleClaim = () => {
     setBalance(prev => prev + miningDelta);
     setMiningDelta(0);
     // هنا لاحقاً سنضيف كود إرسال الرصيد لقاعدة البيانات
  };

  return (
    <main className="flex min-h-screen flex-col items-center justify-between p-6 font-sans overflow-hidden">
      
      {/* الرصيد الإجمالي */}
      <div className="w-full text-center mt-4">
        <h1 className="text-gray-400 text-xs tracking-widest uppercase mb-2">Assets</h1>
        <h2 className="text-4xl font-bold text-transparent bg-clip-text bg-gradient-to-r from-blue-400 to-purple-500">
          {balance.toFixed(4)} <span className="text-xl text-purple-400">APX</span>
        </h2>
      </div>

      {/* المحافظ */}
      <div className="w-full flex flex-col gap-3 mt-8">
        <div className="bg-slate-900/60 border border-slate-800 rounded-2xl p-4 flex justify-between items-center shadow-inner">
           <span className="text-gray-400 text-sm font-medium">HOLDING WALLET</span>
           <span className="font-semibold text-gray-200">0 APX</span>
        </div>
        <div className="bg-slate-900/60 border border-slate-800 rounded-2xl p-4 flex justify-between items-center shadow-inner">
           <span className="text-gray-400 text-sm font-medium">POOL WALLET</span>
           <span className="font-semibold text-blue-400">{balance.toFixed(4)} APX</span>
        </div>
      </div>

      {/* العداد الديناميكي */}
      <div className="mt-8 text-center">
         <h3 className="text-5xl font-black text-blue-400 drop-shadow-[0_0_15px_rgba(96,165,250,0.6)] tabular-nums">
           +{miningDelta.toFixed(4)}
         </h3>
      </div>

      {/* العملة المركزية (التصميم) */}
      <div className="flex-1 flex items-center justify-center my-8 relative">
        <div className="absolute inset-0 bg-blue-500 blur-[80px] opacity-20 rounded-full"></div>
        <div className="w-48 h-48 rounded-full bg-gradient-to-br from-blue-700 to-purple-900 border-4 border-slate-700 flex items-center justify-center shadow-[0_0_40px_rgba(139,92,246,0.4)] z-10">
           <span className="text-6xl font-black tracking-tighter text-white drop-shadow-md">APX</span>
        </div>
      </div>

      {/* زر المطالبة */}
      <button 
        onClick={handleClaim}
        className="w-full py-4 mt-auto mb-4 rounded-2xl bg-gradient-to-r from-blue-600 to-purple-600 text-lg font-bold shadow-[0_4px_20px_rgba(79,70,229,0.4)] active:scale-95 transition-all"
      >
        CLAIM APEX
      </button>
    </main>
  );
}
