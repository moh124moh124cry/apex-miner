"use client";
import React, { useState } from 'react';

export default function InstructionsButton() {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <>
      {/* الزر العائم: تم نقله لأسفل اليمين ليكون مرتباً ولا يتداخل مع التطبيق */}
      <button
        onClick={() => setIsOpen(true)}
        className="fixed bottom-24 right-4 z-50 w-12 h-12 flex items-center justify-center rounded-full bg-blue-600 border-2 border-blue-400 shadow-[0_0_15px_rgba(37,99,235,0.5)] text-2xl hover:scale-105 active:scale-95 transition-all"
        aria-label="How it works"
      >
        📖
      </button>

      {/* النافذة المنبثقة: تم رفع الـ z-index وتوضيح الألوان */}
      {isOpen && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/85 backdrop-blur-sm p-4">
          <div className="bg-[#0f172a] border border-[#1e293b] rounded-2xl w-full max-w-md p-5 relative shadow-2xl">
            
            {/* رأس النافذة مع زر الإغلاق بجانب العنوان مباشرة */}
            <div className="flex justify-between items-center mb-6 border-b border-slate-700 pb-3">
              <h2 className="text-2xl font-black text-white drop-shadow-md">
                How it Works
              </h2>
              <button
                onClick={() => setIsOpen(false)}
                className="w-8 h-8 flex items-center justify-center rounded-full bg-slate-800 text-white hover:bg-red-500 transition-colors text-sm font-bold"
              >
                ✕
              </button>
            </div>

            {/* قائمة التعليمات بألوان فاتحة وتباين عالي */}
            <div className="space-y-4">
              
              <div className="flex items-start gap-3 bg-slate-800/60 p-3 rounded-xl border border-slate-700">
                <div className="flex-shrink-0 w-10 h-10 flex items-center justify-center bg-yellow-500/20 rounded-full text-xl shadow-inner">⚡</div>
                <div>
                  <h3 className="font-bold text-white text-base">1. Mine APEX Points</h3>
                  <p className="text-xs text-gray-300 mt-1 leading-relaxed">Your rig mines automatically at 0.00025 APEX/sec. Points will later convert to APX Tokens.</p>
                </div>
              </div>

              <div className="flex items-start gap-3 bg-slate-800/60 p-3 rounded-xl border border-slate-700">
                <div className="flex-shrink-0 w-10 h-10 flex items-center justify-center bg-blue-500/20 rounded-full text-xl shadow-inner">👥</div>
                <div>
                  <h3 className="font-bold text-white text-base">2. Invite & Earn</h3>
                  <p className="text-xs text-gray-300 mt-1 leading-relaxed">Get a +5% permanent mining speed boost for every active friend you invite.</p>
                </div>
              </div>

              <div className="flex items-start gap-3 bg-slate-800/60 p-3 rounded-xl border border-slate-700">
                <div className="flex-shrink-0 w-10 h-10 flex items-center justify-center bg-purple-500/20 rounded-full text-xl shadow-inner">🚀</div>
                <div>
                  <h3 className="font-bold text-white text-base">3. Upgrade Your Rig</h3>
                  <p className="text-xs text-gray-300 mt-1 leading-relaxed">Use APEX or GRAM via TonConnect to purchase Servers and ASICs for massive speed boosts.</p>
                </div>
              </div>

            </div>

            {/* زر التأكيد السفلي */}
            <button
              onClick={() => setIsOpen(false)}
              className="w-full mt-6 py-3 rounded-xl bg-gradient-to-r from-blue-600 to-blue-700 text-white font-bold text-lg shadow-[0_0_15px_rgba(37,99,235,0.4)] active:scale-95 transition-all"
            >
              Got it! Let's Mine ⛏️
            </button>
          </div>
        </div>
      )}
    </>
  );
}
