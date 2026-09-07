import { NextResponse } from 'next/server';
import { supabaseAdmin } from '../../../lib/supabase-admin';

export const runtime = 'nodejs';

export async function GET() {
  try {
    const { data, error } = await supabaseAdmin.rpc(
      'apex_global_stats'
    );

    if (error) {
      console.error('Global stats RPC error:', error.code);

      return NextResponse.json(
        { error: 'Database error' },
        { status: 500 }
      );
    }

    const result = Array.isArray(data) ? data[0] : data;

    const totalUsers = Number(result?.total_users || 0);

    const countries = Array.isArray(result?.countries)
      ? result.countries
      : [];

    return NextResponse.json(
      {
        success: true,
        totalUsers,
        countries,
      },
      {
        headers: {
          'Cache-Control':
            'public, s-maxage=300, stale-while-revalidate=600',
        },
      }
    );
  } catch (error) {
    console.error(
      'Global stats API error:',
      error instanceof Error ? error.message : 'Unknown error'
    );

    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
