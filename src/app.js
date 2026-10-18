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
import { ViewOnceService } from './services/viewonce.js';
import { WhatsAppClient } from './services/whatsapp.js';
import { createAuthProvider } from './services/authProvider.js';
import { startRetentionJob } from './services/retention.js';
import { createDashboard } from './services/dashboard.js';
import { SessionManager } from './services/sessionManager.js';
import { startKeepAlive } from './services/keepAlive.js';
import { TenantsRepository } from './database/index.js';
import { loadBrandImage } from './services/branding.js';
import { CommandRegistry, CommandRouter } from './commands/index.js';
import { registerEvents } from './events/index.js';
import { setupAutoFeatures } from './services/autoFeatures.js';
import { setupAutoJoin } from './services/autoJoin.js';
import { WordGameService } from './services/wordGame.js';

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
  const permissions = new PermissionService({ config, users: repos.users, settings });
  const mediaStore = new MediaStore({ dir: config.media.dir, cipher, logger });
  const registry = await CommandRegistry.load();
  const brandImage = await loadBrandImage(config.bot.brandImagePath, logger);

  baileys ??= await import('@whiskeysockets/baileys');
  const client = new WhatsAppClient({
    config, logger, baileys, onError: report,
    authProvider: createAuthProvider({ config, db: database.db, cipher, baileys }),
  });

  const ownerJids = config.owners.map((o) => (o.includes('@') ? o : numberToJid(o)));
  const archive = new ArchiveService({ config, repos, logger, client, mediaStore, settings });
  const deletions = new DeletionNotifier({ repos, client, logger, mediaStore, ttlHours: config.privacy.cacheTtlHours, ownerJid: ownerJids[0] });
  const viewOnce = new ViewOnceService({ client, logger, ownerJid: ownerJids[0] });

  errorReporter.setNotifier((text) => Promise.all(ownerJids.map((j) => client.sendText(j, text))));

  let shuttingDown = false;
  async function shutdown(code = 0, reason = 'shutdown') {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info({ reason, code }, 'shutting down');
    const force = setTimeout(() => exit(code || 1), 10_000);
    force.unref();
    retention.stop();
    keepAlive.stop();
    clearInterval(sweepTimer);
    await Promise.allSettled([client.stop(), dashboard.stop()]);
    await Promise.allSettled([database.close()]);
    clearTimeout(force);
    exit(code);
  }

  const deps = {
    config, logger, db: database, cipher, ...repos, settings, errorReporter, limiter, permissions,
    mediaStore, registry, client, archive, deletions, viewOnce, ownerJids, brandImage,
    sessionManager: null, tenants: null,
    wordGame: new WordGameService(database.db),
  };
  deps.router = new CommandRouter({ registry, permissions, users: repos.users, limiter, errorReporter, config });
  registerEvents(deps);
  setupAutoFeatures(client, logger, deps);
  setupAutoJoin(client, logger, ownerJids);
  client.on('fatal', ({ reason }) => shutdown(1, `fatal:${reason}`));

  const retention = startRetentionJob({
    messageCache: repos.messageCache, mediaStore, logger, intervalMs: config.privacy.retentionSweepMs, onError: report,
  });
  const sweepTimer = setInterval(() => limiter.sweep(), 60_000);
  sweepTimer.unref();

  const keepAlive = startKeepAlive(logger);
  const tenants = new TenantsRepository(database.db);
  await tenants.ensureIndexes();
  const sessionManager = new SessionManager({ config, db: database.db, cipher, baileys, logger, tenants });
  deps.sessionManager = sessionManager;
  deps.tenants = tenants;

  // resume any previously connected tenants
  for (const t of await tenants.list()) {
    if (t.status === 'open' || t.status === 'reconnecting') {
      sessionManager.startSession(t.phone).catch((err) => logger.warn({ err, phone: t.phone }, 'failed to resume tenant session'));
    }
  }

  const dashboard = createDashboard({
    sessionManager, tenants,
    getStatus: async () => ({ mongo: await database.ping(), uptimeSec: Math.round(process.uptime()) }),
    logger,
    db: database.db,
    botName: config.bot.name,
  });

  return {
    deps,
    shutdown,
    async start() {
      if (config.health.port > 0) {
        const addr = await dashboard.start(config.health.port, config.health.host);
        logger.info({ port: addr.port }, 'server listening — dashboard at /fd');
      }
      await client.start();
      logger.info({ version: config.version, mode: config.bot.mode, commands: registry.unique.length }, 'bot started');
    },
  };
}
