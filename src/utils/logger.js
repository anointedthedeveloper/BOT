import pino from 'pino';
import { createRequire } from 'node:module';

/**
 * Keys that must never reach logs: session credentials, keys, tokens, connection strings, QR data
 * and message bodies. Redaction applies to the key anywhere up to 3 levels deep.
 */
export const REDACT_PATHS = [
  'creds', 'keys', 'authState', 'auth', 'qr', 'pairingCode', 'password', 'token', 'secret', 'uri',
  'mongoUri', 'encryptionKey', 'text', 'body', 'content', 'message',
  ...['creds', 'keys', 'authState', 'auth', 'qr', 'pairingCode', 'password', 'token', 'secret', 'uri', 'mongoUri', 'encryptionKey', 'text', 'body', 'content', 'message']
    .flatMap((k) => [`*.${k}`, `*.*.${k}`]),
  'noiseKey', 'signedIdentityKey', 'signedPreKey', 'advSecretKey', '*.noiseKey', '*.signedIdentityKey', '*.signedPreKey', '*.advSecretKey',
];

export function createLogger(config, destination) {
  const opts = {
    level: config.logging.level,
    base: { app: config.bot.name },
    redact: { paths: REDACT_PATHS, censor: '[redacted]' },
    timestamp: pino.stdTimeFunctions.isoTime,
    serializers: { err: pino.stdSerializers.err },
  };
  if (config.logging.pretty && !destination) {
    try {
      const require = createRequire(import.meta.url);
      require.resolve('pino-pretty');
      return pino({ ...opts, transport: { target: 'pino-pretty', options: { colorize: true } } });
    } catch {
      /* pino-pretty not installed (production install): fall back to JSON */
    }
  }
  return pino(opts, destination);
}

export function createSilentLogger() {
  return pino({ level: 'silent' });
}
