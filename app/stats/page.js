"use client";
import { useState, useEffect } from 'react';
import { supabase } from '../../lib/supabase'; // استدعاء قاعدة البيانات

export default function Stats() {
  const [stats, setStats] = useState([]);
  const [totalUsers, setTotalUsers] = useState(0);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function fetchStats() {
      // جلب عمود الدولة فقط لجميع المستخدمين لتسريع العملية
      const { data, error } = await supabase.from('users').select('country');

      if (data) {
        setTotalUsers(data.length);
        const countryCounts = {};

        data.forEach(user => {
          const c = user.country;
          // حساب الدول المسجلة فقط (تجاهل المتصلين الجدد الذين لم يلتقطهم النظام بعد)
          if (c && c !== 'Unknown') {
            countryCounts[c] = (countryCounts[c] || 0) + 1;
          }
        });

        // تحويل البيانات إلى قائمة وترتيبها من الدولة الأكثر نشاطاً إلى الأقل
        const sortedStats = Object.keys(countryCounts)
          .map(key => ({ country: key, count: countryCounts[key] }))
          .sort((a, b) => b.count - a.count);

        setStats(sortedStats);
      }
      setLoading(false);
    }
    fetchStats();
  }, []);

  const getFlagIcon = (countryCode) => {
    const lowerCode = countryCode.toLowerCase();
    return (
      <img
        src={`https://flagcdn.com/w40/${lowerCode}.png`}
        alt={countryCode}
        className="w-8 h-5 object-cover rounded shadow-md"
      />
    );
  };

  return (
    <main className="min-h-screen bg-slate-950 text-white p-6 font-sans pb-20">
      <div className="max-w-md mx-auto mt-8">
        <h1 className="text-3xl font-black text-transparent bg-clip-text bg-gradient-to-r from-yellow-400 to-orange-500 mb-2 text-center uppercase tracking-widest">
          Global Miners
        </h1>
        <p className="text-gray-400 text-center text-sm mb-10 bg-slate-900 py-2 rounded-xl border border-slate-800">
          Total Registered Accounts: <strong className="text-white text-lg">{totalUsers}</strong>
        </p>

        {loading ? (
          <div className="flex justify-center mt-20">
            <div className="w-12 h-12 border-4 border-yellow-500 border-t-transparent rounded-full animate-spin"></div>
          </div>
        ) : (
          <div className="flex flex-col gap-4">
            {stats.length === 0 ? (
              <p className="text-center text-gray-500 mt-10">Waiting for active miners to log in...</p>
            ) : (
              stats.map((item, index) => (
                <div key={item.country} className="bg-slate-900 border border-slate-800 rounded-2xl p-4 flex items-center justify-between shadow-[0_4px_15px_rgba(0,0,0,0.3)]">
                  <div className="flex items-center gap-4">
                    <span className="text-gray-600 font-black w-5 text-center">{index + 1}</span>
                    {getFlagIcon(item.country)}
                    <span className="font-bold text-xl">{item.country.toUpperCase()}</span>
                  </div>
                  <div className="bg-yellow-500/10 border border-yellow-500/30 px-4 py-2 rounded-xl flex items-center gap-1">
                    <span className="text-yellow-400 font-black text-lg">{item.count}</span>
                    <span className="text-gray-400 text-[10px] uppercase tracking-wider mt-1">Miners</span>
                  </div>
                </div>
              ))
            )}
          </div>
        )}
      </div>
    </main>
  );
}
