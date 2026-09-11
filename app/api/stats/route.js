import { NextResponse } from 'next/server';
import { supabaseAdmin } from '../../../lib/supabase-admin';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const revalidate = 0;

const SUCCESS_HEADERS = {
  'Cache-Control': 'public, max-age=0, must-revalidate',
  'CDN-Cache-Control': 'public, s-maxage=300, stale-while-revalidate=600',
  'Vercel-CDN-Cache-Control':
    'public, s-maxage=300, stale-while-revalidate=600',
};

const SEARCH_HEADERS = {
  'Cache-Control': 'no-store, max-age=0',
  'CDN-Cache-Control': 'no-store',
  'Vercel-CDN-Cache-Control': 'no-store',
};

const ERROR_HEADERS = {
  'Cache-Control': 'no-store',
};

function normalizeUsername(value) {
  const username = String(value || '')
    .trim()
    .replace(/^@+/, '');

  if (!username) {
    return '';
  }

  if (!/^[A-Za-z0-9_]{1,64}$/.test(username)) {
    return '';
  }

  return username;
}

function escapeIlike(value) {
  return String(value)
    .replace(/\\/g, '\\\\')
    .replace(/%/g, '\\%')
    .replace(/_/g, '\\_');
}

function countValue(result) {
  if (result?.error) {
    throw result.error;
  }

  return Number(result?.count || 0);
}

async function searchUserByUsername(rawUsername) {
  const username = normalizeUsername(rawUsername);

  if (!username) {
    return {
      status: 400,
      body: {
        success: false,
        error: 'INVALID_USERNAME',
      },
    };
  }

  const usernamePattern = escapeIlike(username);

  const { data: user, error: userError } = await supabaseAdmin
    .from('users')
    .select(
      'telegram_id, username, country, balance, created_at'
    )
    .ilike('username', usernamePattern)
    .limit(1)
    .maybeSingle();

  if (userError) {
    console.error(
      'Stats user search error:',
      userError.code
    );

    throw userError;
  }

  if (!user) {
    return {
      status: 404,
      body: {
        success: false,
        error: 'USER_NOT_FOUND',
      },
    };
  }

  const balance = Number(user.balance || 0);
  const telegramId = String(user.telegram_id || '');
  const country = user.country
    ? String(user.country).toUpperCase()
    : null;

  let rowNumber = null;

  if (telegramId) {
    const rowPositionResult = await supabaseAdmin
      .from('users')
      .select('telegram_id', {
        count: 'exact',
        head: true,
      })
      .lte('telegram_id', telegramId);

    rowNumber = countValue(rowPositionResult);
  }

  const [higherBalanceResult, totalUsersResult] = await Promise.all([
    supabaseAdmin
      .from('users')
      .select('telegram_id', {
        count: 'exact',
        head: true,
      })
      .gt('balance', balance),

    supabaseAdmin
      .from('users')
      .select('telegram_id', {
        count: 'exact',
        head: true,
      }),
  ]);

  const globalRank =
    countValue(higherBalanceResult) + 1;

  const totalUsers =
    countValue(totalUsersResult);

  let countryRank = null;
  let countryUsers = null;

  if (country) {
    const [countryHigherResult, countryUsersResult] =
      await Promise.all([
        supabaseAdmin
          .from('users')
          .select('telegram_id', {
            count: 'exact',
            head: true,
          })
          .eq('country', country)
          .gt('balance', balance),

        supabaseAdmin
          .from('users')
          .select('telegram_id', {
            count: 'exact',
            head: true,
          })
          .eq('country', country),
      ]);

    countryRank =
      countValue(countryHigherResult) + 1;

    countryUsers =
      countValue(countryUsersResult);
  }

  return {
    status: 200,
    body: {
      success: true,
      user: {
        username: user.username || username,
        country,
        balance,
        database: {
          schema: 'public',
          table: 'users',
          rowNumber,
          rowOrder: 'telegram_id ASC',
        },
        ranking: {
          globalRank,
          totalUsers,
          countryRank,
          countryUsers,
          basis: 'APXN Points balance',
        },
      },
    },
  };
}

export async function GET(request) {
  try {
    const username =
      request?.nextUrl?.searchParams?.get('username');

    if (username !== null) {
      const result =
        await searchUserByUsername(username);

      return NextResponse.json(
        result.body,
        {
          status: result.status,
          headers: SEARCH_HEADERS,
        }
      );
    }

    const { data, error } = await supabaseAdmin.rpc(
      'apex_global_stats'
    );

    if (error) {
      console.error(
        'Global stats RPC error:',
        error.code
      );

      return NextResponse.json(
        {
          error: 'Database error',
        },
        {
          status: 500,
          headers: ERROR_HEADERS,
        }
      );
    }

    const result =
      Array.isArray(data)
        ? data[0]
        : data;

    const totalUsers =
      Number(
        result?.total_users || 0
      );

    const countries =
      Array.isArray(
        result?.countries
      )
        ? result.countries
        : [];

    return NextResponse.json(
      {
        success: true,
        totalUsers,
        countries,
      },
      {
        status: 200,
        headers: SUCCESS_HEADERS,
      }
    );
  } catch (error) {
    console.error(
      'Global stats API error:',
      error instanceof Error
        ? error.message
        : 'Unknown error'
    );

    return NextResponse.json(
      {
        error:
          'Internal server error',
      },
      {
        status: 500,
        headers: ERROR_HEADERS,
      }
    );
  }
}

