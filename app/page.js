"use client";
import React from 'react';

export default function ApexWhitepaper() {
  return (
    <div className="min-h-screen bg-slate-950 text-slate-200 font-sans selection:bg-blue-500 selection:text-white pb-20">
      
      {/* Header Section */}
      <header className="pt-20 pb-12 text-center px-4">
        <h1 className="text-4xl md:text-6xl font-extrabold text-transparent bg-clip-text bg-gradient-to-r from-blue-400 to-emerald-400 mb-4">
          Apex Network (APXN)
        </h1>
        <p className="text-lg md:text-xl text-slate-400 max-w-2xl mx-auto">
          الورقة البيضاء الرسمية وخريطة الطريق للمستقبل المالي اللامركزي
        </p>
      </header>

      <main className="max-w-5xl mx-auto px-6 space-y-16">
        
        {/* ICO & Ticket System Section */}
        <section className="bg-slate-900 border border-slate-800 rounded-2xl p-8 relative overflow-hidden shadow-2xl">
          <div className="absolute top-0 right-0 bg-blue-600 text-white text-xs font-bold px-4 py-1 rounded-bl-lg">
            مرحلة نشطة
          </div>
          <h2 className="text-2xl font-bold text-white mb-6 flex items-center gap-3">
            <svg className="w-6 h-6 text-blue-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 5v2m0 4v2m0 4v2M5 5a2 2 0 00-2 2v3a2 2 0 110 4v3a2 2 0 002 2h14a2 2 0 002-2v-3a2 2 0 110-4V7a2 2 0 00-2-2H5z"></path></svg>
            البيع الأولي (ICO) - نظام التذاكر
          </h2>
          <div className="grid md:grid-cols-2 gap-8">
            <div>
              <p className="text-slate-300 leading-relaxed mb-4">
                يتم حالياً طرح عملة APXN في مرحلتها الأولى حصرياً عبر تطبيقنا الرسمي بنظام "التذاكر". هذه المرحلة تتيح للمستثمرين الأوائل والمجتمع الداعم فرصة الحصول على العملة بسعر تفضيلي ومستقر قبل الإدراج الرسمي على منصات التداول اللامركزية (DEX).
              </p>
              <div className="bg-slate-800 rounded-lg p-4 inline-block border border-slate-700">
                <p className="text-sm text-slate-400 mb-1">سعر التذكرة (البيع الأولي)</p>
                <p className="text-3xl font-bold text-emerald-400">0.10 $ <span className="text-lg text-slate-300">/ APXN</span></p>
              </div>
            </div>
            <div className="space-y-4">
              <div className="flex justify-between items-center border-b border-slate-800 pb-2">
                <span className="text-slate-400">إجمالي العرض (Total Supply)</span>
                <span className="font-semibold text-white">100,000,000 APXN</span>
              </div>
              <div className="flex justify-between items-center border-b border-slate-800 pb-2">
                <span className="text-slate-400">الشبكة</span>
                <span className="font-semibold text-white">Binance Smart Chain (BEP-20)</span>
              </div>
              <div className="flex justify-between items-center pb-2">
                <span className="text-slate-400">حالة التداول العام</span>
                <span className="font-semibold text-amber-400">مغلق (مرحلة التوزيع فقط)</span>
              </div>
            </div>
          </div>
        </section>

        {/* Smart Contract & Transparency Section (NEW) */}
        <section className="space-y-6">
          <h2 className="text-3xl font-bold text-white border-b border-slate-800 pb-4">الشفافية والأمان التقني</h2>
          <div className="grid md:grid-cols-3 gap-6">
            
            {/* Card 1: Thirdweb */}
            <div className="bg-slate-900 border border-slate-800 p-6 rounded-xl hover:border-blue-500 transition-colors">
              <div className="w-12 h-12 bg-blue-900/50 rounded-lg flex items-center justify-center mb-4">
                <svg className="w-6 h-6 text-blue-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z"></path></svg>
              </div>
              <h3 className="text-xl font-semibold text-white mb-2">عقد موثق وآمن</h3>
              <p className="text-sm text-slate-400">
                تم بناء وسك العملة باستخدام العقود القياسية لمنصة <strong>Thirdweb</strong> العالمية. هذا يضمن أن الكود البرمجي خضع لتدقيق أمني صارم (Audited) ومحمي من الثغرات أو الأكواد الخبيثة.
              </p>
            </div>

            {/* Card 2: BscScan */}
            <div className="bg-slate-900 border border-slate-800 p-6 rounded-xl hover:border-emerald-500 transition-colors">
              <div className="w-12 h-12 bg-emerald-900/50 rounded-lg flex items-center justify-center mb-4">
                <svg className="w-6 h-6 text-emerald-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M21 12a9 9 0 01-9 9m9-9a9 9 0 00-9-9m9 9H3m9 9a9 9 0 01-9-9m9 9c1.657 0 3-4.03 3-9s-1.343-9-3-9m0 18c-1.657 0-3-4.03-3-9s1.343-9 3-9m-9 9a9 9 0 019-9"></path></svg>
              </div>
              <h3 className="text-xl font-semibold text-white mb-2">شفافية البلوكتشين</h3>
              <p className="text-sm text-slate-400 mb-4">
                كود المصدر (Source Code) موثق بالكامل ومتاح للعامة. يمكنك تتبع كل معاملة بوضوح وشفافية مطلقة.
              </p>
              <a 
                href="https://bscscan.com/token/0x88074bA197BBB0a3AFF891E52d05764F98509956#transactions" 
                target="_blank" 
                rel="noopener noreferrer"
                className="inline-flex items-center text-xs font-medium text-emerald-400 hover:text-emerald-300"
              >
                تحقق على BscScan 
                <svg className="w-4 h-4 ml-1" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"></path></svg>
              </a>
            </div>

            {/* Card 3: Tokenomics Integrity */}
            <div className="bg-slate-900 border border-slate-800 p-6 rounded-xl hover:border-purple-500 transition-colors">
              <div className="w-12 h-12 bg-purple-900/50 rounded-lg flex items-center justify-center mb-4">
                <svg className="w-6 h-6 text-purple-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"></path></svg>
              </div>
              <h3 className="text-xl font-semibold text-white mb-2">نزاهة اقتصاد العملة</h3>
              <ul className="text-sm text-slate-400 space-y-2">
                <li className="flex items-center gap-2">
                  <div className="w-1.5 h-1.5 rounded-full bg-purple-400"></div> لا توجد وظيفة طباعة إضافية (No Mint).
                </li>
                <li className="flex items-center gap-2">
                  <div className="w-1.5 h-1.5 rounded-full bg-purple-400"></div> عقد خالي من الضرائب المخفية (No Taxes).
                </li>
                <li className="flex items-center gap-2">
                  <div className="w-1.5 h-1.5 rounded-full bg-purple-400"></div> العرض الإجمالي ثابت نهائياً لحماية القيمة.
                </li>
              </ul>
            </div>
          </div>
        </section>

        {/* Roadmap Section */}
        <section className="space-y-8">
          <h2 className="text-3xl font-bold text-white border-b border-slate-800 pb-4">خريطة الطريق (Roadmap)</h2>
          <div className="relative border-l border-slate-700 ml-3 md:ml-6 space-y-10 pb-4">
            
            {/* Phase 1 */}
            <div className="relative pl-8 md:pl-12">
              <div className="absolute -left-3 md:-left-3.5 top-1 w-6 h-6 bg-blue-500 rounded-full border-4 border-slate-950"></div>
              <h3 className="text-xl font-bold text-white mb-2">المرحلة الأولى: التأسيس والطرح الأولي (نحن هنا)</h3>
              <ul className="list-disc list-inside text-slate-400 space-y-1">
                <li>نشر وتوثيق العقد الذكي على Binance Smart Chain.</li>
                <li>تطوير وإطلاق منصة/تطبيق إدارة التذاكر.</li>
                <li>بدء البيع الأولي (ICO) الحصري بسعر 0.1$.</li>
                <li>بناء النواة الأولى للمجتمع والمستثمرين الداعمين.</li>
              </ul>
            </div>

            {/* Phase 2 */}
            <div className="relative pl-8 md:pl-12">
              <div className="absolute -left-3 md:-left-3.5 top-1 w-6 h-6 bg-slate-700 rounded-full border-4 border-slate-950"></div>
              <h3 className="text-xl font-bold text-slate-300 mb-2">المرحلة الثانية: التوسع اللامركزي</h3>
              <ul className="list-disc list-inside text-slate-500 space-y-1">
                <li>إغلاق مرحلة البيع الأولي (ICO) بنجاح.</li>
                <li>إنشاء مسبح السيولة (Liquidity Pool) على منصة PancakeSwap.</li>
                <li>فتح باب التداول العام وترك التسعير لآليات العرض والطلب الحرة.</li>
              </ul>
            </div>

            {/* Phase 3 */}
            <div className="relative pl-8 md:pl-12">
              <div className="absolute -left-3 md:-left-3.5 top-1 w-6 h-6 bg-slate-700 rounded-full border-4 border-slate-950"></div>
              <h3 className="text-xl font-bold text-slate-300 mb-2">المرحلة الثالثة: الإدراج والتطوير البيئي</h3>
              <ul className="list-disc list-inside text-slate-500 space-y-1">
                <li>التقدم بطلبات الإدراج الرسمية على CoinMarketCap و CoinGecko.</li>
                <li>إطلاق حملات تسويقية موسعة لجذب سيولة خارجية.</li>
                <li>دمج عملة APXN كأداة دفع وفائدة حقيقية ضمن مشاريعنا الرقمية.</li>
              </ul>
            </div>

          </div>
        </section>

      </main>
    </div>
  );
}
