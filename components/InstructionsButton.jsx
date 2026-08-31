"use client";
import React, { useState } from 'react';

export default function InstructionsButton() {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <>
      {/* الزر العائم */}
      <button
        onClick={() => setIsOpen(true)}
        className="fixed left-3 top-1/2 -translate-y-1/2 z-40 p-3 rounded-full bg-slate-800/80 backdrop-blur-md border border-blue-500/30 shadow-[0_0_15px_rgba(59,130,246,0.2)] text-2xl hover:scale-110 hover:border-blue-400 transition-all duration-300"
        aria-label="How it works"
      >
        📖
      </button>

      {/* النافذة المنبثقة */}
      {isOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4 transition-opacity">
          <div className="bg-slate-950 border border-slate-800 rounded-2xl w-full max-w-md p-6 relative shadow-2xl animate-in fade-in zoom-in-95 duration-200">
            
            <button
              onClick={() => setIsOpen(false)}
              className="absolute top-4 right-4 text-slate-500 hover:text-red-400 text-xl transition-colors"
            >
              ✖️
            </button>

            <h2 className="text-2xl font-extrabold bg-gradient-to-r from-blue-400 to-blue-600 bg-clip-text text-transparent mb-6 text-center">
              How ApexMiner Works
            </h2>

            <div className="space-y-5 text-slate-300">
              
              <div className="flex items-start gap-3">
                <div className="p-2 bg-slate-900 rounded-lg text-xl shadow-inner">⚡</div>
                <div>
                  <h3 className="font-bold text-slate-200">1. Mine APEX Points</h3>
                  <p className="text-sm text-slate-400 mt-1">Your rig mines automatically at 0.00025 APEX/sec. APEX points will later be converted to APX Tokens.</p>
                </div>
              </div>

              <div className="flex items-start gap-3">
                <div className="p-2 bg-slate-900 rounded-lg text-xl shadow-inner">👥</div>
                <div>
                  <h3 className="font-bold text-slate-200">2. Invite & Earn</h3>
                  <p className="text-sm text-slate-400 mt-1">Get a +5% permanent mining speed boost for every active friend you invite.</p>
                </div>
              </div>

              <div className="flex items-start gap-3">
                <div className="p-2 bg-slate-900 rounded-lg text-xl shadow-inner">🚀</div>
                <div>
                  <h3 className="font-bold text-slate-200">3. Upgrade Your Rig</h3>
                  <p className="text-sm text-slate-400 mt-1">Use your mined APEX or GRAM via TonConnect to purchase Cloud Servers and Quantum ASICs for massive speed boosts.</p>
                </div>
              </div>

            </div>

            <button
              onClick={() => setIsOpen(false)}
              className="w-full mt-8 py-3 rounded-xl bg-gradient-to-r from-blue-600 to-blue-800 text-white font-bold hover:from-blue-500 hover:to-blue-700 shadow-lg shadow-blue-900/50 transition-all active:scale-95"
            >
              Start Mining Now
            </button>
          </div>
        </div>
      )}
    </>
  );
}
