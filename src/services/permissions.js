import { isPnJid, jidNumber } from '../utils/jid.js';

export const ROLE_LEVEL = Object.freeze({ banned: -1, none: 0, user: 1, admin: 2, owner: 3 });

export const hasRole = (role, required) => (ROLE_LEVEL[role] ?? 0) >= (ROLE_LEVEL[required] ?? 99);

// Simple TTL cache: jid -> { role, user, expiresAt }
const CACHE_TTL_MS = 60_000; // 1 minute

export class PermissionService {
  constructor({ config, users, settings = null, sessionManager = null }) {
    this.config = config;
    this.users = users;
    this.settings = settings;
    this.sessionManager = sessionManager;
    this.ownerIds = new Set(config.owners);
    this._cache = new Map();
  }

  /** Call this after any role/ban change so the cache doesn't serve stale data. */
  invalidate(jid) {
    this._cache.delete(jid);
  }

  isOwner({ candidates = [], fromMe = false }) {
    if (fromMe) return true;
    return candidates.some((c) => this.ownerIds.has(c) || (isPnJid(c) && this.ownerIds.has(jidNumber(c))));
  }

  async resolve({ jid, candidates, fromMe }) {
    // The tenant's own number is always owner regardless of adminUse
    const tenantPhone = this.config.owners[0];
    const isTenantOwner = fromMe || candidates.some((c) => {
      const num = c.split('@')[0].split(':')[0];
      return num === tenantPhone;
    });

    if (isTenantOwner) return { role: 'owner', user: null };

    // Global admin access — blocked if globally disabled
    const adminUseEnabled = this.sessionManager
      ? await this.sessionManager.getGlobalAdminUse()
      : (this.settings?.adminUse !== false && (this.settings?.adminUse ?? true));
    if (adminUseEnabled) {
      const isGlobalAdmin = this.isOwner({ candidates, fromMe: false });
      if (isGlobalAdmin) return { role: 'owner', user: null };
    }
    // Check cache first
    const cached = this._cache.get(jid);
    if (cached && cached.expiresAt > Date.now()) return { role: cached.role, user: cached.user };

    const user = await this.users.get(jid);
    const mode = this.settings?.botMode ?? this.config.bot.mode;
    let role;
    if (user?.banned) role = 'banned';
    else if (user?.role === 'admin') role = 'admin';
    else if (mode === 'public' || user?.allowed) role = 'user';
    else role = 'none';

    this._cache.set(jid, { role, user, expiresAt: Date.now() + CACHE_TTL_MS });
    // Prevent unbounded growth
    if (this._cache.size > 2000) {
      const firstKey = this._cache.keys().next().value;
      this._cache.delete(firstKey);
    }
    return { role, user };
  }
}
