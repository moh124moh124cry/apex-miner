import crypto from 'crypto';

// =====================================================
// Telegram Mini App authentication limits
// =====================================================
//
// Keep all Telegram initData validation in one place.
//
// Every API route that calls validateTelegramInitData()
// automatically receives the same protections.
// =====================================================

const MAX_INIT_DATA_LENGTH = 8192;
const MAX_AUTH_AGE_SECONDS = 24 * 60 * 60;
const MAX_FUTURE_CLOCK_SKEW_SECONDS = 60;

// Telegram sends SHA-256 hash as exactly 64 hex characters.
const SHA256_HEX_PATTERN = /^[a-f0-9]{64}$/i;

// =====================================================
// Telegram Mini App initData verification
// =====================================================

export function validateTelegramInitData(initData) {
  // ---------------------------------------------------
  // 1. Basic input validation
  // ---------------------------------------------------

  if (
    !initData ||
    typeof initData !== 'string'
  ) {
    throw new Error(
      'Missing Telegram init data'
    );
  }

  // Prevent unnecessarily large request data from
  // reaching URL parsing / cryptographic validation.
  //
  // This protection now applies automatically to:
  // - Auth
  // - Bootstrap
  // - Register
  // - Mining
  // - Check-In
  // - Daily Tasks
  // - Social Tasks
  // - Friends
  if (
    initData.length >
    MAX_INIT_DATA_LENGTH
  ) {
    throw new Error(
      'Invalid Telegram init data'
    );
  }

  // ---------------------------------------------------
  // 2. Server secret
  // ---------------------------------------------------

  const botToken =
    process.env.BOT_TOKEN;

  if (!botToken) {
    throw new Error(
      'Missing BOT_TOKEN'
    );
  }

  // ---------------------------------------------------
  // 3. Parse Telegram data
  // ---------------------------------------------------

  let params;

  try {
    params =
      new URLSearchParams(
        initData
      );
  } catch {
    throw new Error(
      'Invalid Telegram init data'
    );
  }

  const receivedHash =
    params.get('hash');

  const authDate =
    params.get('auth_date');

  if (
    !receivedHash ||
    !authDate
  ) {
    throw new Error(
      'Invalid Telegram init data'
    );
  }

  // The Telegram hash must be a complete SHA-256
  // hexadecimal digest.
  if (
    !SHA256_HEX_PATTERN.test(
      receivedHash
    )
  ) {
    throw new Error(
      'Invalid Telegram signature'
    );
  }

  // ---------------------------------------------------
  // 4. Build Telegram data-check-string
  // ---------------------------------------------------
  //
  // "hash" itself must not participate in validation.
  // Every other Telegram field remains included.
  // ---------------------------------------------------

  params.delete('hash');

  const dataCheckString =
    Array.from(
      params.entries()
    )
      .sort(
        ([keyA], [keyB]) =>
          keyA.localeCompare(
            keyB
          )
      )
      .map(
        ([key, value]) =>
          `${key}=${value}`
      )
      .join('\n');

  // ---------------------------------------------------
  // 5. Verify Telegram HMAC
  // ---------------------------------------------------

  const secretKey =
    crypto
      .createHmac(
        'sha256',
        'WebAppData'
      )
      .update(botToken)
      .digest();

  const calculatedHash =
    crypto
      .createHmac(
        'sha256',
        secretKey
      )
      .update(
        dataCheckString
      )
      .digest('hex');

  const receivedBuffer =
    Buffer.from(
      receivedHash,
      'hex'
    );

  const calculatedBuffer =
    Buffer.from(
      calculatedHash,
      'hex'
    );

  if (
    receivedBuffer.length !==
      calculatedBuffer.length ||
    !crypto.timingSafeEqual(
      receivedBuffer,
      calculatedBuffer
    )
  ) {
    throw new Error(
      'Invalid Telegram signature'
    );
  }

  // ---------------------------------------------------
  // 6. Validate auth_date
  // ---------------------------------------------------

  const authTimestamp =
    Number(authDate);

  const now =
    Math.floor(
      Date.now() / 1000
    );

  if (
    !Number.isInteger(
      authTimestamp
    ) ||
    authTimestamp <= 0
  ) {
    throw new Error(
      'Expired Telegram init data'
    );
  }

  // Reject timestamps too far in the future.
  if (
    authTimestamp >
    now +
      MAX_FUTURE_CLOCK_SKEW_SECONDS
  ) {
    throw new Error(
      'Expired Telegram init data'
    );
  }

  // Existing application policy:
  // Telegram authentication is accepted for 24 hours.
  if (
    now - authTimestamp >
    MAX_AUTH_AGE_SECONDS
  ) {
    throw new Error(
      'Expired Telegram init data'
    );
  }

  // ---------------------------------------------------
  // 7. Validate Telegram user payload
  // ---------------------------------------------------

  const userRaw =
    params.get('user');

  if (!userRaw) {
    throw new Error(
      'Telegram user not found'
    );
  }

  let user;

  try {
    user =
      JSON.parse(userRaw);
  } catch {
    throw new Error(
      'Invalid Telegram user data'
    );
  }

  if (
    !user ||
    user.id === undefined ||
    user.id === null ||
    user.id === ''
  ) {
    throw new Error(
      'Invalid Telegram user'
    );
  }

  // Telegram user IDs must be numeric and positive.
  //
  // We do not convert the ID here.
  // Existing API routes remain responsible for using
  // String(user.id) or passing it to the existing RPCs.
  const numericUserId =
    Number(user.id);

  if (
    !Number.isSafeInteger(
      numericUserId
    ) ||
    numericUserId <= 0
  ) {
    throw new Error(
      'Invalid Telegram user'
    );
  }

  // ---------------------------------------------------
  // 8. Return trusted Telegram information
  // ---------------------------------------------------

  return {
    user,

    authDate:
      authTimestamp,

    queryId:
      params.get(
        'query_id'
      ) || null,

    startParam:
      params.get(
        'start_param'
      ) || null,
  };
}
