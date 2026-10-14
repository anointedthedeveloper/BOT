import { createCipherBox } from './utils/crypto.js';
import { createLogger } from './utils/logger.js';
import { numberToJid } from './utils/jid.js';
import { connectDatabase, createRepositories } from './database/index.js';
import { RuntimeSettings } from './services/settings.js';
import { PermissionService } from './services/permissions.js';
import { RateLimiter } from './services/rateLimiter.js';
import { ErrorReporter } from './services/errorReporter.js';
import { MediaStore } from './services/mediaStore.js';
import { ArchiveService } from './services/archive.js';
import { DeletionNotifier } from './services/deletions.js';
import { WhatsAppClient } from './services/whatsapp.js';
import { createAuthProvider } from './services/authProvider.js';
import { startRetentionJob } from './services/retention.js';
import { createHealthServer } from './services/health.js';
import { CommandRegistry, CommandRouter } from './commands/index.js';
import { registerEvents } from './events/index.js';

/**
 * Composition root. Builds every service, wires events and returns lifecycle controls.
 * Collaborators (logger, database, baileys, exit) can be injected for tests.
 */
export async function createApp(config, { logger = createLogger(config), database, baileys, exit = process.exit } = {}) {
  const cipher = createCipherBox(config.privacy.encryptionKey);
  if (!cipher.enabled) logger.warn('DATA_ENCRYPTION_KEY is not set: saved data is stored unencrypted');

  database ??= await connectDatabase(config.mongo, logger);
  const repos = await createRepositories(database.db, config, cipher);
  const settings = await new RuntimeSettings(config, repos.botConfig).load();

  const errorReporter = new ErrorReporter({ logger, notifyOwner: config.errors.notifyOwner });
  const report = (err, ctx) => errorReporter.report(err, ctx);
  const limiter = new RateLimiter(config.rateLimit);
  const permissions = new PermissionService({ config, users: repos.users });
  const mediaStore = new MediaStore({ dir: config.media.dir, cipher, logger });
  const registry = await CommandRegistry.load();

  baileys ??= await import('@whiskeysockets/baileys');
  const client = new WhatsAppClient({
    config, logger, baileys, onError: report,
    authProvider: createAuthProvider({ config, db: database.db, cipher, baileys }),
  });

  const archive = new ArchiveService({ config, repos, logger, client, mediaStore });
  const deletions = new DeletionNotifier({ repos, client, logger, mediaStore, ttlHours: config.privacy.cacheTtlHours });

  const ownerJids = config.owners.map((o) => (o.includes('@') ? o : numberToJid(o)));
  errorReporter.setNotifier((text) => Promise.all(ownerJids.map((j) => client.sendText(j, text))));

  let shuttingDown = false;
  async function shutdown(code = 0, reason = 'shutdown') {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info({ reason, code }, 'shutting down');
    const force = setTimeout(() => exit(code || 1), 10_000);
    force.unref();
    retention.stop();
    clearInterval(sweepTimer);
    await Promise.allSettled([client.stop(), health.stop()]);
    await Promise.allSettled([database.close()]);
    clearTimeout(force);
    exit(code);
  }

  const requestRestart = async (by) => {
    logger.warn({ by, mode: config.bot.restartMode }, 'restart requested');
    if (config.bot.restartMode === 'exit') return shutdown(0, 'restart');
    await client.restart();
  };

  const deps = {
    config, logger, db: database, cipher, ...repos, settings, errorReporter, limiter, permissions,
    mediaStore, registry, client, archive, deletions, requestRestart, pendingRestarts: new Map(), ownerJids,
  };
  deps.router = new CommandRouter({ registry, permissions, users: repos.users, limiter, errorReporter, config });
  registerEvents(deps);
  client.on('fatal', ({ reason }) => shutdown(1, `fatal:${reason}`));

  const retention = startRetentionJob({
    items: repos.items, messageCache: repos.messageCache, mediaStore, logger, intervalMs: config.privacy.retentionSweepMs, onError: report,
  });
  const sweepTimer = setInterval(() => limiter.sweep(), 60_000);
  sweepTimer.unref();

  const health = createHealthServer({
    logger,
    getStatus: async () => ({ whatsapp: client.status, mongo: await database.ping(), uptimeSec: Math.round(process.uptime()), version: config.version }),
  });

  return {
    deps,
    health,
    shutdown,
    async start() {
      if (config.health.port > 0) {
        const addr = await health.start(config.health.port, config.health.host);
        logger.info({ port: addr.port }, 'health endpoint listening');
      }
      await client.start();
      logger.info({ version: config.version, mode: config.bot.mode, commands: registry.unique.length }, 'bot started');
    },
  };
}
