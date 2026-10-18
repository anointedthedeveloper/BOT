import { WhatsAppClient } from './whatsapp.js';
import { useMongoAuthState } from '../database/authState.js';
import { CommandRegistry, CommandRouter } from '../commands/index.js';
import { PermissionService } from './permissions.js';
import { RateLimiter } from './rateLimiter.js';
import { ErrorReporter } from './errorReporter.js';
import { MediaStore } from './mediaStore.js';
import { ArchiveService } from './archive.js';
import { DeletionNotifier } from './deletions.js';
import { ViewOnceService } from './viewonce.js';
import { RuntimeSettings } from './settings.js';
import { loadBrandImage } from './branding.js';
import { registerEvents } from '../events/index.js';
import { numberToJid } from '../utils/jid.js';
import { BotConfigRepository } from '../database/botConfig.js';
import { UsersRepository } from '../database/users.js';
import { ChatsRepository } from '../database/chats.js';
import { MessageCacheRepository } from '../database/messageCache.js';
import { ensureIndexes } from '../database/connection.js';
import { setupAutoJoin } from './autoJoin.js';
import { setupAutoFeatures } from './autoFeatures.js';
import { WordGameService } from './wordGame.js';

export class SessionManager {
  constructor({ config, db, cipher, baileys, logger, tenants }) {
    this.config = config;
    this.db = db;
    this.cipher = cipher;
    this.baileys = baileys;
    this.logger = logger;
    this.tenants = tenants;
    this.sessions = new Map();
    this._globalAdminUse = true; // loaded from DB on first access
    this._globalAdminUseLoaded = false;
  }

  async getGlobalAdminUse() {
    if (!this._globalAdminUseLoaded) {
      const doc = await this.db.collection('global_settings').findOne({ _id: 'adminUse' });
      this._globalAdminUse = doc ? doc.value !== false : true;
      this._globalAdminUseLoaded = true;
    }
    return this._globalAdminUse;
  }

  async setGlobalAdminUse(enabled) {
    this._globalAdminUse = Boolean(enabled);
    this._globalAdminUseLoaded = true;
    await this.db.collection('global_settings').updateOne(
      { _id: 'adminUse' },
      { $set: { value: Boolean(enabled) } },
      { upsert: true }
    );
    // Invalidate all active tenant permission caches immediately
    for (const session of this.sessions.values()) {
      session.deps?.permissions?._cache.clear();
    }
  }

  async startSession(phone, { pairingPhone = null } = {}) {
    if (this.sessions.has(phone)) return this.sessions.get(phone);

    const log = this.logger.child({ tenant: phone });
    const p = `t_${phone}_`;

    // Register immediately so status polls never 404 during async setup
    const session = { phone, status: 'connecting', pairingCode: null, pairingError: null, client: null, startedAt: Date.now() };
    this.sessions.set(phone, session);
    const cleanup = () => { if (this.sessions.get(phone) === session) this.sessions.delete(phone); };

    try {
      const repos = {
        users: new UsersRepository(this.db, `${p}users`),
        chats: new ChatsRepository(this.db, `${p}chats`),
        messageCache: new MessageCacheRepository(this.db, { cipher: this.cipher, ttlHours: this.config.privacy.cacheTtlHours }, `${p}message_cache`),
        botConfig: new BotConfigRepository(this.db, `${p}bot_config`),
      };
      await ensureIndexes(this.db, p);

      const settings = await new RuntimeSettings(this.config, repos.botConfig).load();
      const errorReporter = new ErrorReporter({ logger: log, notifyOwner: false });
      const limiter = new RateLimiter(this.config.rateLimit);
      const tenantConfig = { ...this.config, owners: [...new Set([phone, ...this.config.owners])], auth: { ...this.config.auth, pairingPhoneNumber: pairingPhone } };
      const permissions = new PermissionService({ config: tenantConfig, users: repos.users, settings, sessionManager: this });
      const mediaStore = new MediaStore({ dir: this.config.media.dir, cipher: this.cipher, logger: log });
      const registry = await CommandRegistry.load();
      const brandImage = await loadBrandImage(this.config.bot.brandImagePath, log);

      // Auto-remove if not connected within 10 minutes
      const pairingTimeout = setTimeout(async () => {
        if (session.status === 'open') return;
        log.warn({ phone }, 'session pairing timeout — removing');
        await this.stopSession(phone);
        await this.tenants.setStatus(phone, 'failed').catch(() => {});
      }, 10 * 60 * 1000);
      pairingTimeout.unref();
      session.pairingTimeout = pairingTimeout;

      const client = new WhatsAppClient({
        config: tenantConfig, logger: log, baileys: this.baileys,
        onError: (err, ctx) => errorReporter.report(err, ctx),
        authProvider: async () => useMongoAuthState(this.db, { baileys: this.baileys, cipher: this.cipher, collection: `wa_auth_${phone}` }),
      });

      client.on('pairing-code', ({ code }) => {
        session.pairingCode = code;
        session.status = 'pairing';
        session.pairingError = null;
      });
      client.on('qr', () => {
        if (session.status !== 'open') session.status = 'qr';
      });
      client.on('pairing-error', ({ message }) => {
        session.pairingError = message;
      });

      session.client = client;

      const ownerJid = numberToJid(phone);
      const archive = new ArchiveService({ config: tenantConfig, repos, logger: log, client, mediaStore, settings });
      const deletions = new DeletionNotifier({ repos, client, logger: log, mediaStore, ttlHours: this.config.privacy.cacheTtlHours, ownerJid });
      const viewOnce = new ViewOnceService({ client, logger: log, ownerJid });

      const deps = {
        config: tenantConfig, logger: log, db: { db: this.db }, cipher: this.cipher,
        ...repos, settings, errorReporter, limiter, permissions,
        mediaStore, registry, client, archive, deletions, viewOnce,
        ownerJids: [ownerJid], brandImage,
        sessionManager: this, tenants: this.tenants,
        wordGame: new WordGameService(this.db),
      };
      session.deps = deps;
      deps.router = new CommandRouter({ registry, permissions, users: repos.users, limiter, errorReporter, config: tenantConfig });
      registerEvents(deps);
      setupAutoFeatures(client, log, deps);
      setupAutoJoin(client, log, [ownerJid]);

      client.on('open', async () => {
        session.status = 'open';
        session.pairingCode = null;
        clearTimeout(session.pairingTimeout);
        await this.tenants.setStatus(phone, 'open').catch(() => {});
      });
      client.on('fatal', async () => {
        session.status = 'failed';
        clearTimeout(session.pairingTimeout);
        await this.tenants.setStatus(phone, 'failed').catch(() => {});
        this.sessions.delete(phone);
      });
      client.on('close', async () => {
        if (session.status === 'open') {
          session.status = 'reconnecting';
          await this.tenants.setStatus(phone, 'reconnecting').catch(() => {});
        }
      });

      await client.start();
      log.info({ phone }, 'tenant session started');
      return session;
    } catch (err) {
      cleanup();
      throw err;
    }
  }

  getSession(phone) { return this.sessions.get(phone) ?? null; }

  async stopSession(phone) {
    const s = this.sessions.get(phone);
    if (s) {
      clearTimeout(s.pairingTimeout);
      await s.client?.stop();
      this.sessions.delete(phone);
    }
  }

  listSessions() {
    return [...this.sessions.values()].map(({ phone, status }) => ({ phone, status }));
  }
}
