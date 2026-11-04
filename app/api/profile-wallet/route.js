import { NextResponse } from 'next/server';
import { supabaseAdmin } from '../../../lib/supabase-admin';
import { validateTelegramInitData } from '../../../lib/telegram-auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function reply(body, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: { 'Cache-Control': 'no-store' },
  });
}

const BSC_ADDRESS = /^0x[a-fA-F0-9]{40}$/;
const ZERO_ADDRESS = /^0x0{40}$/i;

export async function POST(request) {
  try {
    const body = await request.json();
    const telegram = validateTelegramInitData(body?.initData);
    const telegramId = String(telegram.user.id);
    const action = body?.action || 'load';

    if (action !== 'load' && action !== 'save') {
      return reply({ error: 'Invalid action' }, 400);
    }

    // Only existing APXN users can save an airdrop wallet.
    const { data: member, error: memberError } = await supabaseAdmin
      .from('users')
      .select('telegram_id')
      .eq('telegram_id', telegramId)
      .maybeSingle();

    if (memberError) return reply({ error: 'Database unavailable' }, 500);
    if (!member) return reply({ error: 'APXN member not found' }, 403);

    const { data: saved, error: readError } = await supabaseAdmin
      .from('user_wallets')
      .select('wallet_address, wallet_verified')
      .eq('telegram_id', telegramId)
      .maybeSingle();

    if (readError) {
      console.error('BSC wallet read failed:', readError.code);
      return reply({ error: 'Could not load wallet' }, 500);
    }

    if (action === 'load') {
      return reply({
        success: true,
        address: saved?.wallet_address || '',
        verified: Boolean(saved?.wallet_verified),
      });
    }

    const address = String(body?.address || '').trim();
    if (!BSC_ADDRESS.test(address) || ZERO_ADDRESS.test(address)) {
      return reply({ error: 'Enter a valid BSC address (0x + 40 hex characters)' }, 400);
    }

    // Do not reset a verified wallet when saving the same address.
    if (saved?.wallet_address?.toLowerCase() === address.toLowerCase()) {
      return reply({
        success: true,
        address: saved.wallet_address,
        verified: Boolean(saved.wallet_verified),
      });
    }

    const { error: saveError } = await supabaseAdmin
      .from('user_wallets')
      .upsert({
        telegram_id: telegramId,
        wallet_address: address,
        chain_id: 56,
        wallet_verified: false,
        verified_at: null,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'telegram_id' });

    if (saveError) {
      console.error('BSC wallet save failed:', saveError.code);
      return reply({ error: 'Could not save wallet' }, 500);
    }

    return reply({ success: true, address, verified: false });
  } catch (error) {
    const message = error instanceof Error ? error.message : '';
    const authError = /Telegram|BOT_TOKEN|Expired|signature|init data/i.test(message);
    if (!authError) console.error('Wallet API request failed:', message);
    return reply({
      error: authError ? 'Invalid Telegram authentication' : 'Request failed',
    }, authError ? 401 : 500);
  }
}

