import { supabaseAdmin } from './supabase-admin';

export const APXN_STARS_BOOST_PRICE = 10;
export const APXN_STARS_BOOST_DURATION_HOURS = 48;
// Only NEW v2 invoices receive 5,000 points. Old apxn48 invoices still receive 10,000.
export const APXN_STARS_BOOST_REWARD_POINTS = 5000;
export const APXN_STARS_BOOST_REWARD_LABEL = '5,000 APXN POINTS';

function parseStarsBoostPayload(payload) {
  const value = String(payload || '');
  const parts = value.split(':');
  if (
    parts.length !== 3 ||
    !['apxn48', 'apxn48v2'].includes(parts[0]) ||
    !parts[1] ||
    !parts[2]
  ) {
    return null;
  }
  return {
    telegramId: parts[1],
    nonce: parts[2],
    rewardPoints: parts[0] === 'apxn48' ? 10000 : 5000,
  };
}

export function validateStarsBoostPreCheckout(query) {
  const payloadData = parseStarsBoostPayload(query?.invoice_payload);
  if (!payloadData) {
    return { valid: false, error: 'Invalid APXN 48H Mining Boost payment.' };
  }
  if (query?.currency !== 'XTR') {
    return { valid: false, error: 'This boost must be paid with Telegram Stars.' };
  }
  if (Number(query?.total_amount) !== APXN_STARS_BOOST_PRICE) {
    return { valid: false, error: 'Invalid price for APXN 48H Mining Boost.' };
  }
  const payerTelegramId = String(query?.from?.id || '');
  if (!payerTelegramId || payerTelegramId !== payloadData.telegramId) {
    return { valid: false, error: 'This payment does not belong to this Telegram account.' };
  }
  return { valid: true, telegramId: payloadData.telegramId };
}

export async function activateStarsBoostFromSuccessfulPayment({ from, successfulPayment }) {
  const payloadData = parseStarsBoostPayload(successfulPayment?.invoice_payload);
  if (!payloadData) throw new Error('INVALID_STARS_BOOST_PAYLOAD');
  const telegramId = String(from?.id || '');
  if (!telegramId || telegramId !== payloadData.telegramId) {
    throw new Error('STARS_BOOST_TELEGRAM_ID_MISMATCH');
  }
  if (successfulPayment?.currency !== 'XTR') {
    throw new Error('STARS_BOOST_INVALID_CURRENCY');
  }
  if (Number(successfulPayment?.total_amount) !== APXN_STARS_BOOST_PRICE) {
    throw new Error('STARS_BOOST_INVALID_AMOUNT');
  }
  const telegramChargeId = String(successfulPayment?.telegram_payment_charge_id || '');
  if (!telegramChargeId) throw new Error('STARS_BOOST_MISSING_TELEGRAM_CHARGE_ID');
  const providerChargeId = String(successfulPayment?.provider_payment_charge_id || '');
  const { data, error } = await supabaseAdmin.rpc('apex_activate_stars_boost_payment', {
    p_telegram_id: telegramId,
    p_charge_id: telegramChargeId,
    p_provider_charge_id: providerChargeId,
    p_payload: successfulPayment.invoice_payload,
    p_stars_amount: APXN_STARS_BOOST_PRICE,
  });
  if (error) {
    console.error('Stars boost activation RPC error:', error.code);
    throw new Error('STARS_BOOST_DATABASE_ERROR');
  }
  const result = Array.isArray(data) ? data[0] : data;
  if (!result) throw new Error('STARS_BOOST_INVALID_DATABASE_RESULT');
  if (!result.success) throw new Error(result.error_code || 'STARS_BOOST_ACTIVATION_FAILED');
  return {
    success: true,
    telegramId,
    stars: APXN_STARS_BOOST_PRICE,
    // The invoice version determines the reward. Never use a global 5k
    // value when acknowledging a previously issued legacy 10k invoice.
    rewardPoints: payloadData.rewardPoints,
    rewardLabel: `${payloadData.rewardPoints.toLocaleString('en-US')} APXN POINTS`,
    durationHours: APXN_STARS_BOOST_DURATION_HOURS,
    starsBoostStartedAt: result.stars_boost_started_at || null,
    starsBoostUntil: result.stars_boost_until || null,
    starsBoostCount: Number(result.stars_boost_count || 0),
  };
}

