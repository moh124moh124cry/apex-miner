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

const ERROR_HEADERS = {
  'Cache-Control': 'no-store',
};

export async function GET() {
  try {
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

