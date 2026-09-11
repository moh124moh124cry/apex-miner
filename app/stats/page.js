"use client";

import { useState, useEffect } from 'react';

export default function Stats() {
  const [stats, setStats] = useState([]);
  const [totalUsers, setTotalUsers] = useState(0);
  const [loading, setLoading] = useState(true);

  const [username, setUsername] = useState('');
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState('');
  const [userResult, setUserResult] = useState(null);

  useEffect(() => {
    let cancelled = false;

    async function fetchStats() {
      try {
        const response = await fetch('/api/stats');

        if (!response.ok) {
          throw new Error('Failed to load global stats');
        }

        const result = await response.json();

        if (cancelled) return;

        setTotalUsers(Number(result?.totalUsers || 0));
        setStats(
          Array.isArray(result?.countries)
            ? result.countries
            : []
        );
      } catch (error) {
        console.error(
          'Global stats load error:',
          error instanceof Error ? error.message : 'Unknown error'
        );

        if (!cancelled) {
          setTotalUsers(0);
          setStats([]);
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    fetchStats();

    return () => {
      cancelled = true;
    };
  }, []);

  const getFlagIcon = (countryCode) => {
    if (!countryCode) {
      return (
        <div className="w-8 h-5 rounded bg-slate-800 border border-slate-700" />
      );
    }

    const lowerCode = String(countryCode).toLowerCase();

    return (
      <img
        src={`https://flagcdn.com/w40/${lowerCode}.png`}
        alt={countryCode}
        className="w-8 h-5 object-cover rounded shadow-md"
      />
    );
  };

  const formatNumber = (value) => {
    const number = Number(value);

    if (!Number.isFinite(number)) {
      return '0';
    }

    return number.toLocaleString('en-US', {
      maximumFractionDigits: 8,
    });
  };

  const SUPABASE_ROWS_PER_PAGE = 100;

  const getSupabasePageInfo = (rowNumber) => {
    const row = Number(rowNumber);

    if (!Number.isFinite(row) || row < 1) {
      return {
        pageNumber: null,
        positionOnPage: null,
      };
    }

    return {
      pageNumber:
        Math.floor((row - 1) / SUPABASE_ROWS_PER_PAGE) + 1,
      positionOnPage:
        ((row - 1) % SUPABASE_ROWS_PER_PAGE) + 1,
    };
  };

  const cleanUsername = (value) => {
    return String(value || '')
      .trim()
      .replace(/^@+/, '');
  };

  async function searchUser(event) {
    event?.preventDefault();

    const query = cleanUsername(username);

    setSearchError('');
    setUserResult(null);

    if (!query) {
      setSearchError('Enter a Telegram username.');
      return;
    }

    if (!/^[A-Za-z0-9_]{1,64}$/.test(query)) {
      setSearchError('Enter a valid Telegram username.');
      return;
    }

    setSearching(true);

    try {
      const response = await fetch(
        `/api/stats?username=${encodeURIComponent(query)}`,
        {
          method: 'GET',
          cache: 'no-store',
          headers: {
            Accept: 'application/json',
          },
        }
      );

      let data = null;

      try {
        data = await response.json();
      } catch {
        data = null;
      }

      if (response.status === 404) {
        setSearchError('Telegram user not found in APXN.');
        return;
      }

      if (response.status === 400) {
        setSearchError('Enter a valid Telegram username.');
        return;
      }

      if (!response.ok || !data?.success || !data?.user) {
        setSearchError('Could not search right now. Please try again.');
        return;
      }

      setUserResult(data.user);
    } catch (error) {
      console.error(
        'User search error:',
        error instanceof Error ? error.message : 'Unknown error'
      );

      setSearchError('Connection error. Please try again.');
    } finally {
      setSearching(false);
    }
  }

  function clearSearch() {
    setUsername('');
    setUserResult(null);
    setSearchError('');
  }

  return (
    <main className="min-h-screen bg-slate-950 text-white p-6 font-sans pb-20">
      <div className="max-w-md mx-auto mt-8">
        <h1 className="text-3xl font-black text-transparent bg-clip-text bg-gradient-to-r from-yellow-400 to-orange-500 mb-2 text-center uppercase tracking-widest">
          Global Miners
        </h1>

        <p className="text-gray-400 text-center text-sm mb-6 bg-slate-900 py-2 rounded-xl border border-slate-800">
          Total Registered Accounts:{' '}
          <strong className="text-white text-lg">{totalUsers}</strong>
        </p>

        <section className="mb-8 bg-slate-900 border border-slate-800 rounded-2xl p-4 shadow-[0_4px_20px_rgba(0,0,0,0.35)]">
          <div className="mb-4">
            <p className="text-[10px] font-black uppercase tracking-[0.2em] text-yellow-400 mb-1">
              User Lookup
            </p>

            <h2 className="text-xl font-black">
              Find a Telegram User
            </h2>

            <p className="text-xs text-gray-500 mt-1 leading-relaxed">
              Search by Telegram username to view the APXN database row
              and current ranking.
            </p>
          </div>

          <form
            onSubmit={searchUser}
            className="flex gap-2"
          >
            <div className="flex-1 min-w-0 relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500 font-black">
                @
              </span>

              <input
                type="text"
                value={username}
                onChange={(event) => {
                  setUsername(event.target.value);
                  setSearchError('');
                }}
                placeholder="telegram_username"
                autoComplete="off"
                autoCapitalize="none"
                spellCheck="false"
                className="w-full bg-slate-950 border border-slate-700 rounded-xl py-3 pl-8 pr-3 text-sm font-bold text-white outline-none transition-colors focus:border-yellow-500 placeholder:text-gray-700"
              />
            </div>

            <button
              type="submit"
              disabled={searching}
              className="shrink-0 px-4 py-3 rounded-xl bg-gradient-to-b from-yellow-300 to-orange-500 text-slate-950 font-black text-sm border border-yellow-300 shadow-[0_4px_0_#92400e] disabled:opacity-60 disabled:cursor-not-allowed"
            >
              {searching ? 'Searching...' : 'Search'}
            </button>
          </form>

          {searchError ? (
            <div className="mt-4 rounded-xl border border-red-500/25 bg-red-500/10 px-4 py-3 text-sm text-red-300">
              {searchError}
            </div>
          ) : null}

          {userResult ? (
            <div className="mt-5 rounded-2xl border border-yellow-500/30 bg-slate-950/70 p-4">
              <div className="flex items-start justify-between gap-3 mb-5">
                <div className="min-w-0">
                  <div className="text-[10px] uppercase tracking-widest text-gray-500 font-black mb-1">
                    Telegram User
                  </div>

                  <div className="text-xl font-black text-yellow-300 truncate">
                    @{userResult.username}
                  </div>
                </div>

                <div className="shrink-0 rounded-xl border border-yellow-500/30 bg-yellow-500/10 px-3 py-2 text-center">
                  <div className="text-[9px] text-gray-500 uppercase tracking-widest font-black">
                    Global Rank
                  </div>

                  <div className="text-xl font-black text-yellow-400">
                    #{userResult?.ranking?.globalRank ?? '—'}
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="rounded-xl border border-slate-800 bg-slate-900/80 p-3">
                  <div className="text-[9px] uppercase tracking-widest text-gray-600 font-black mb-1">
                    Supabase Location
                  </div>

                  <div className="text-sm font-black break-all">
                    {userResult?.database?.schema || 'public'}.
                    {userResult?.database?.table || 'users'}
                  </div>
                </div>

                <div className="rounded-xl border border-slate-800 bg-slate-900/80 p-3">
                  <div className="text-[9px] uppercase tracking-widest text-gray-600 font-black mb-1">
                    Row Number
                  </div>

                  <div className="text-lg font-black">
                    #{userResult?.database?.rowNumber ?? '—'}
                  </div>
                </div>

                <div className="rounded-xl border border-violet-500/20 bg-violet-500/5 p-3">
                  <div className="text-[9px] uppercase tracking-widest text-gray-600 font-black mb-1">
                    Supabase Page
                  </div>

                  <div className="text-lg font-black text-violet-300">
                    #{getSupabasePageInfo(
                      userResult?.database?.rowNumber
                    ).pageNumber ?? '—'}
                  </div>
                </div>

                <div className="rounded-xl border border-fuchsia-500/20 bg-fuchsia-500/5 p-3">
                  <div className="text-[9px] uppercase tracking-widest text-gray-600 font-black mb-1">
                    Position on Page
                  </div>

                  <div className="text-lg font-black text-fuchsia-300">
                    #{getSupabasePageInfo(
                      userResult?.database?.rowNumber
                    ).positionOnPage ?? '—'}
                  </div>
                </div>

                <div className="rounded-xl border border-slate-800 bg-slate-900/80 p-3">
                  <div className="text-[9px] uppercase tracking-widest text-gray-600 font-black mb-1">
                    APXN Points
                  </div>

                  <div className="text-lg font-black text-yellow-400">
                    {formatNumber(userResult.balance)}
                  </div>
                </div>

                <div className="rounded-xl border border-slate-800 bg-slate-900/80 p-3">
                  <div className="text-[9px] uppercase tracking-widest text-gray-600 font-black mb-1">
                    Country
                  </div>

                  <div className="flex items-center gap-2">
                    {getFlagIcon(userResult.country)}

                    <span className="text-lg font-black">
                      {userResult.country || '—'}
                    </span>
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3 mt-3">
                <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-3">
                  <div className="text-[9px] uppercase tracking-widest text-gray-600 font-black mb-1">
                    Global Position
                  </div>

                  <div className="text-sm font-black text-emerald-300">
                    #{userResult?.ranking?.globalRank ?? '—'} of{' '}
                    {formatNumber(userResult?.ranking?.totalUsers)}
                  </div>
                </div>

                <div className="rounded-xl border border-sky-500/20 bg-sky-500/5 p-3">
                  <div className="text-[9px] uppercase tracking-widest text-gray-600 font-black mb-1">
                    Country Position
                  </div>

                  <div className="text-sm font-black text-sky-300">
                    {userResult?.ranking?.countryRank
                      ? `#${userResult.ranking.countryRank} of ${formatNumber(
                          userResult?.ranking?.countryUsers
                        )}`
                      : '—'}
                  </div>
                </div>
              </div>

              <p className="text-[10px] text-gray-600 mt-4 leading-relaxed">
                Row Number uses registration order (created_at ascending).
                Supabase Page and Position on Page are calculated using
                100 rows per page. Ranking uses the current APXN Points
                balance.
              </p>

              <button
                type="button"
                onClick={clearSearch}
                className="mt-4 w-full py-2.5 rounded-xl border border-slate-700 bg-slate-900 text-gray-300 font-black text-xs"
              >
                Clear Search
              </button>
            </div>
          ) : null}
        </section>

        {loading ? (
          <div className="flex justify-center mt-20">
            <div className="w-12 h-12 border-4 border-yellow-500 border-t-transparent rounded-full animate-spin"></div>
          </div>
        ) : (
          <div className="flex flex-col gap-4">
            {stats.length === 0 ? (
              <p className="text-center text-gray-500 mt-10">
                Waiting for active miners to log in...
              </p>
            ) : (
              stats.map((item, index) => (
                <div
                  key={item.country}
                  className="bg-slate-900 border border-slate-800 rounded-2xl p-4 flex items-center justify-between shadow-[0_4px_15px_rgba(0,0,0,0.3)]"
                >
                  <div className="flex items-center gap-4">
                    <span className="text-gray-600 font-black w-5 text-center">
                      {index + 1}
                    </span>

                    {getFlagIcon(item.country)}

                    <span className="font-bold text-xl">
                      {item.country.toUpperCase()}
                    </span>
                  </div>

                  <div className="bg-yellow-500/10 border border-yellow-500/30 px-4 py-2 rounded-xl flex items-center gap-1">
                    <span className="text-yellow-400 font-black text-lg">
                      {item.count}
                    </span>
                    <span className="text-gray-400 text-[10px] uppercase tracking-wider mt-1">
                      Miners
                    </span>
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

