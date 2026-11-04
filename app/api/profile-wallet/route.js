import { NextResponse } from 'next/server';
import { supabaseAdmin } from '../../../lib/supabase-admin';
import { validateTelegramInitData } from '../../../lib/telegram-auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const BSC_ADDRESS = /^0x[a-fA-F0-9]{40}$/;
const ZERO_ADDRESS = /^0x0{40}$/i;

function reply(body, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: { 'Cache-Control': 'no-store' },
  });
}

// The monthly change window follows Algeria time, not the phone clock.
function monthInAlgiers(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Africa/Algiers',
    year: 'numeric',
    month: '2-digit',
  }).formatToParts(date);
  const year = parts.find((part) => part.type === 'year').value;
  const month = parts.find((part) => part.type === 'month').value;
  return `${year}-${month}`;
}

function nextMonthDate(monthKey = monthInAlgiers()) {
  const [year, month] = monthKey.split('-').map(Number);
  return new Date(Date.UTC(year, month, 1)).toISOString().slice(0, 10);
}

function walletResult(wallet) {
  const address = wallet?.wallet_address || '';
  const lastEdited = wallet?.last_address_change_at || null;
  const usedMonthlyEdit = Boolean(
    address && lastEdited && monthInAlgiers(new Date(lastEdited)) === monthInAlgiers()
  );
  return {
    success: true,
    address,
    verified: Boolean(wallet?.wallet_verified),
    canEdit: !usedMonthlyEdit,
    nextEditDate: usedMonthlyEdit ? nextMonthDate() : null,
  };
}

export async function POST(request) {
  try {
    const body = await request.json();
    const telegram = validateTelegramInitData(body?.initData);
    const telegramId = String(telegram.user.id);
    const action = body?.action || 'load';

    if (!['load', 'save', 'edit'].includes(action)) {
      return reply({ error: 'Invalid action' }, 400);
    }

    // Identity comes only from server-verified Telegram initData.
    const { data: member, error: memberError } = await supabaseAdmin
      .from('users')
      .select('telegram_id')
      .eq('telegram_id', telegramId)
      .maybeSingle();
    if (memberError) return reply({ error: 'Database unavailable' }, 500);
    if (!member) return reply({ error: 'APXN member not found' }, 403);

    const walletQuery = () => supabaseAdmin
      .from('user_wallets')
      .select('wallet_address, wallet_verified, last_address_change_at')
      .eq('telegram_id', telegramId)
      .maybeSingle();

    const { data: saved, error: readError } = await walletQuery();
    if (readError) {
      console.error('BSC wallet read failed:', readError.code);
      return reply({ error: 'Could not load wallet' }, 500);
    }

    // Any saved wallet associated with an authenticated Telegram numeric ID
    // is verified under APXN policy, even when @username is absent.
    if (saved && !saved.wallet_verified) {
      const { error: verifyError } = await supabaseAdmin
        .from('user_wallets')
        .update({ wallet_verified: true, verified_at: new Date().toISOString() })
        .eq('telegram_id', telegramId);
      if (verifyError) {
        console.error('BSC wallet verification failed:', verifyError.code);
        return reply({ error: 'Could not update wallet verification' }, 500);
      }
      saved.wallet_verified = true;
    }

    if (action === 'load') return reply(walletResult(saved));

    const address = String(body?.address || '').trim();
    if (!BSC_ADDRESS.test(address) || ZERO_ADDRESS.test(address)) {
      return reply({ error: 'Enter a valid BSC address (0x + 40 hex characters)' }, 400);
    }

    if (action === 'edit' && !saved) {
      return reply({ error: 'Save your first wallet address instead' }, 400);
    }

    // Saving the same address changes nothing and does not consume the edit.
    if (saved?.wallet_address?.toLowerCase() === address.toLowerCase()) {
      return reply({ ...walletResult(saved), unchanged: true });
    }

    if (saved && !walletResult(saved).canEdit) {
      return reply({
        error: 'Wallet address can be changed only once per calendar month',
        code: 'WALLET_MONTHLY_LIMIT',
        nextEditDate: nextMonthDate(),
      }, 429);
    }

    // Database trigger independently enforces one CHANGE per calendar month.
    // First-time saves do not consume the edit for that month.
    // APXN policy: saved address + authenticated Telegram numeric ID = verified in-app.
    const { error: saveError } = await supabaseAdmin
      .from('user_wallets')
      .upsert({
        telegram_id: telegramId,
        wallet_address: address,
        chain_id: 56,
        wallet_verified: true,
        verified_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }, { onConflict: 'telegram_id' });

    if (saveError) {
      if (saveError.message?.includes('WALLET_CHANGE_ONCE_PER_MONTH')) {
        return reply({
          error: 'Wallet address can be changed only once per calendar month',
          code: 'WALLET_MONTHLY_LIMIT',
          nextEditDate: nextMonthDate(),
        }, 429);
      }
      console.error('BSC wallet save failed:', saveError.code);
      return reply({ error: 'Could not save wallet' }, 500);
    }

    const { data: updatedWallet, error: updatedError } = await walletQuery();
    if (updatedError || !updatedWallet) {
      return reply({ error: 'Wallet saved but could not reload it' }, 500);
    }
    return reply(walletResult(updatedWallet));
  } catch (error) {
    const message = error instanceof Error ? error.message : '';
    const authError = /Telegram|BOT_TOKEN|Expired|signature|init data/i.test(message);
    if (!authError) console.error('Wallet API request failed:', message);
    return reply({
      error: authError ? 'Invalid Telegram authentication' : 'Request failed',
    }, authError ? 401 : 500);
  }
}

