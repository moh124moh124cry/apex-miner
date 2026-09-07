import crypto from 'crypto';

const MAX_AUTH_AGE_SECONDS = 24 * 60 * 60;

export function validateTelegramInitData(initData) {
  if (!initData || typeof initData !== 'string') {
    throw new Error('Missing Telegram init data');
  }

  const botToken = process.env.BOT_TOKEN;

  if (!botToken) {
    throw new Error('Missing BOT_TOKEN');
  }

  const params = new URLSearchParams(initData);

  const receivedHash = params.get('hash');
  const authDate = params.get('auth_date');

  if (!receivedHash || !authDate) {
    throw new Error('Invalid Telegram init data');
  }

  // لا يدخل hash في عملية التحقق
  params.delete('hash');

  const dataCheckString = Array.from(params.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${key}=${value}`)
    .join('\n');

  const secretKey = crypto
    .createHmac('sha256', 'WebAppData')
    .update(botToken)
    .digest();

  const calculatedHash = crypto
    .createHmac('sha256', secretKey)
    .update(dataCheckString)
    .digest('hex');

  const receivedBuffer = Buffer.from(receivedHash, 'hex');
  const calculatedBuffer = Buffer.from(calculatedHash, 'hex');

  if (
    receivedBuffer.length !== calculatedBuffer.length ||
    !crypto.timingSafeEqual(receivedBuffer, calculatedBuffer)
  ) {
    throw new Error('Invalid Telegram signature');
  }

  const authTimestamp = Number(authDate);
  const now = Math.floor(Date.now() / 1000);

  if (
    !Number.isFinite(authTimestamp) ||
    authTimestamp <= 0 ||
    authTimestamp > now + 60 ||
    now - authTimestamp > MAX_AUTH_AGE_SECONDS
  ) {
    throw new Error('Expired Telegram init data');
  }

  const userRaw = params.get('user');

  if (!userRaw) {
    throw new Error('Telegram user not found');
  }

  let user;

  try {
    user = JSON.parse(userRaw);
  } catch {
    throw new Error('Invalid Telegram user data');
  }

  if (!user?.id) {
    throw new Error('Invalid Telegram user');
  }

  return {
    user,
    authDate: authTimestamp,
    queryId: params.get('query_id') || null,
    startParam: params.get('start_param') || null,
  };
}
