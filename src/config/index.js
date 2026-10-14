import { readFileSync } from 'node:fs';

export class ConfigError extends Error {
  constructor(problems) {
    super(`Invalid configuration:\n - ${problems.join('\n - ')}`);
    this.name = 'ConfigError';
    this.problems = problems;
  }
}

const pkg = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8'));

const TRUE = new Set(['1', 'true', 'yes', 'on']);
const FALSE = new Set(['0', 'false', 'no', 'off']);

/**
 * Builds a validated, frozen configuration object from environment variables.
 * Pure function: pass an env object in tests. Collects every problem before throwing.
 */
export function loadConfig(env = process.env) {
  const problems = [];
  const str = (key, def = '') => {
    const v = env[key];
    return v === undefined || v.trim() === '' ? def : v.trim();
  };
  const bool = (key, def) => {
    const v = str(key, '').toLowerCase();
    if (v === '') return def;
    if (TRUE.has(v)) return true;
    if (FALSE.has(v)) return false;
    problems.push(`${key} must be a boolean (true/false), got "${v}"`);
    return def;
  };
  const int = (key, def, min, max) => {
    const raw = str(key, '');
    if (raw === '') return def;
    const n = Number(raw);
    if (!Number.isInteger(n) || n < min || n > max) {
      problems.push(`${key} must be an integer between ${min} and ${max}, got "${raw}"`);
      return def;
    }
    return n;
  };
  const oneOf = (key, def, allowed) => {
    const v = str(key, def).toLowerCase();
    if (!allowed.includes(v)) {
      problems.push(`${key} must be one of ${allowed.join(', ')}, got "${v}"`);
      return def;
    }
    return v;
  };

  const mongoUri = str('MONGODB_URI');
  if (!mongoUri) problems.push('MONGODB_URI is required');
  else if (!/^mongodb(\+srv)?:\/\//.test(mongoUri)) problems.push('MONGODB_URI must start with mongodb:// or mongodb+srv://');

  // Owners: phone numbers (digits, international format, no "+") or full JIDs.
  const owners = str('OWNER_NUMBERS')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => {
      if (s.includes('@')) return s.toLowerCase();
      const digits = s.replace(/[^\d]/g, '');
      if (digits.length < 7 || digits.length > 15) problems.push(`OWNER_NUMBERS entry "${s}" is not a valid phone number`);
      return digits;
    });
  if (owners.length === 0) problems.push('OWNER_NUMBERS is required (comma separated, e.g. 15551234567)');

  const prefix = str('BOT_PREFIX', '/');
  if (!/^[^\s\p{L}\p{N}]{1,3}$/u.test(prefix)) problems.push('BOT_PREFIX must be 1-3 symbol characters (no letters, digits or spaces), e.g. / ! .');

  const encryptionKey = parseEncryptionKey(str('DATA_ENCRYPTION_KEY'), problems);

  const pairing = str('PAIRING_PHONE_NUMBER').replace(/[^\d]/g, '');
  if (str('PAIRING_PHONE_NUMBER') && (pairing.length < 7 || pairing.length > 15)) {
    problems.push('PAIRING_PHONE_NUMBER is not a valid phone number');
  }

  const config = {
    version: pkg.version,
    env: str('NODE_ENV', 'production'),
    bot: {
      name: str('BOT_NAME', 'UtilityBot').slice(0, 40),
      prefix,
      mode: oneOf('BOT_MODE', 'private', ['private', 'public']),
      allowGroupCommands: bool('ALLOW_GROUP_COMMANDS', true),
      ownerName: str('OWNER_NAME'),
      ownerContact: str('OWNER_CONTACT'),
      restartMode: oneOf('RESTART_MODE', 'reconnect', ['reconnect', 'exit']),
    },
    owners,
    mongo: { uri: mongoUri, dbName: str('MONGODB_DB', 'whatsapp_bot') },
    auth: {
      store: oneOf('AUTH_STORE', 'file', ['file', 'mongo']),
      dir: str('AUTH_DIR', './data/auth'),
      pairingPhoneNumber: pairing || null,
      // Optional: also write the QR as a PNG (useful in Docker/headless hosts with no visible terminal).
      qrImagePath: str('QR_IMAGE_PATH') || null,
    },
    privacy: {
      encryptionKey,
      allowContentLogging: bool('ALLOW_CONTENT_LOGGING', true),
      allowMediaCaching: bool('ALLOW_MEDIA_CACHING', true),
      cacheTtlHours: int('CACHE_TTL_HOURS', 24, 1, 168),
      defaultRetentionDays: int('DEFAULT_RETENTION_DAYS', 30, 0, 3650),
      maxRetentionDays: int('MAX_RETENTION_DAYS', 365, 1, 3650),
      retentionSweepMs: int('RETENTION_SWEEP_MS', 600_000, 1000, 86_400_000),
    },
    media: {
      dir: str('MEDIA_DIR', './data/media'),
      maxBytes: int('MAX_MEDIA_MB', 25, 1, 100) * 1024 * 1024,
      maxItemsPerUser: int('MAX_ITEMS_PER_USER', 2000, 10, 100_000),
    },
    rateLimit: {
      max: int('RATE_LIMIT_MAX', 8, 1, 1000),
      windowMs: int('RATE_LIMIT_WINDOW_MS', 10_000, 1000, 3_600_000),
      cooldownMs: int('RATE_LIMIT_COOLDOWN_MS', 30_000, 1000, 3_600_000),
      strikesBeforeMute: int('RATE_LIMIT_STRIKES', 3, 1, 100),
      muteMs: int('RATE_LIMIT_MUTE_MS', 600_000, 1000, 86_400_000),
    },
    health: {
      port: int('HEALTH_PORT', 3000, 0, 65535),
      host: str('HEALTH_HOST', '127.0.0.1'),
    },
    logging: {
      level: oneOf('LOG_LEVEL', 'info', ['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']),
      baileysLevel: oneOf('BAILEYS_LOG_LEVEL', 'warn', ['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']),
      pretty: bool('LOG_PRETTY', false),
    },
    errors: { notifyOwner: bool('ERROR_NOTIFY_OWNER', true) },
  };

  if (problems.length) throw new ConfigError(problems);
  return deepFreeze(config);
}

function parseEncryptionKey(raw, problems) {
  if (!raw) return null;
  let buf = null;
  if (/^[0-9a-fA-F]{64}$/.test(raw)) buf = Buffer.from(raw, 'hex');
  else {
    const b = Buffer.from(raw, 'base64');
    if (b.length === 32) buf = b;
  }
  if (!buf) problems.push('DATA_ENCRYPTION_KEY must be 32 bytes encoded as 64 hex chars or base64 (generate: openssl rand -hex 32)');
  return buf;
}

function deepFreeze(o) {
  for (const v of Object.values(o)) if (v && typeof v === 'object' && !Buffer.isBuffer(v)) deepFreeze(v);
  return Object.freeze(o);
}
