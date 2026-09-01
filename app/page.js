{discoverView === 'whitepaper' && (
   <div className="px-6 pt-6 w-full">
      <h1 className="text-2xl font-black text-transparent bg-clip-text bg-gradient-to-r from-yellow-400 to-orange-500 text-center uppercase tracking-widest mb-6">Whitepaper v1.2</h1>

      <h2 className="text-lg font-bold text-white border-b border-slate-700 pb-2 mb-4">1. Points vs. Tokens System</h2>
      <div className="bg-slate-900/50 p-4 rounded-xl border border-yellow-700/50 mb-6">
        <p className="text-gray-300 text-xs leading-relaxed mb-3">
          To protect the token economy from hyperinflation and ensure a fair distribution, Apex Network utilizes a dual-layer system:
        </p>
        <ul className="text-xs text-gray-400 space-y-2 ml-4 list-disc">
          <li><strong className="text-yellow-400">APEX Points:</strong> Virtual off-chain mining rewards.</li>
          <li><strong className="text-purple-400">APXN Token:</strong> The on-chain utility token (100 Million Supply).</li>
        </ul>
        <p className="text-green-400 text-[10px] mt-3 font-bold uppercase">
          * Conversion ratio to be finalized before TGE.
        </p>
      </div>

      <h2 className="text-lg font-bold text-white border-b border-slate-700 pb-2 mb-4">2. Technical Details</h2>
      <ul className="text-gray-300 text-xs mb-6 space-y-2 bg-slate-900/50 p-4 rounded-xl border border-slate-800">
        <li><strong className="text-purple-400">Name:</strong> Apex Network</li>
        <li><strong className="text-purple-400">Ticker:</strong> APXN</li>
        <li><strong className="text-purple-400">Blockchain:</strong> The Open Network (TON)</li>
        <li><strong className="text-purple-400">Total Supply:</strong> 100,000,000 APXN <span className="text-yellow-500 font-bold">(Fixed)</span></li>
      </ul>

      <h2 className="text-lg font-bold text-white border-b border-slate-700 pb-2 mb-4">3. Tokenomics</h2>
      <div className="space-y-3 mb-8">
        <div className="bg-slate-900/80 p-3 rounded-xl border border-slate-800 flex items-center justify-between">
          <span className="font-bold text-white text-xs">Community & Airdrop</span>
          <span className="bg-blue-600 text-white px-2 py-1 rounded text-[10px] font-black">63%</span>
        </div>
        <div className="bg-slate-900/80 p-3 rounded-xl border border-slate-800 flex items-center justify-between">
          <span className="font-bold text-white text-xs">Liquidity & Exchanges</span>
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

      <h2 className="text-lg font-bold text-white border-b border-slate-700 pb-2 mb-4">4. Smart Contract Security</h2>
      <div className="bg-slate-900/50 p-4 rounded-xl border border-blue-700/50 mb-8">
         <p className="text-gray-300 text-xs leading-relaxed">
           The APXN Smart Contract is thoroughly secured. To prevent front-running and sniper bots manipulation, the official Contract Address will remain classified until simultaneous publication with the final Airdrop distribution during the TGE phase.
         </p>
      </div>
   </div>
)}
