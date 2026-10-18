import { isPnJid, jidNumber } from '../utils/jid.js';

export const ROLE_LEVEL = Object.freeze({ banned: -1, none: 0, user: 1, admin: 2, owner: 3 });

export const hasRole = (role, required) => (ROLE_LEVEL[role] ?? 0) >= (ROLE_LEVEL[required] ?? 99);

// Simple TTL cache: jid -> { role, user, expiresAt }
const CACHE_TTL_MS = 60_000; // 1 minute

export class PermissionService {
  constructor({ config, users }) {
    this.config = config;
    this.users = users;
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
    if (this.isOwner({ candidates: candidates.length ? candidates : [jid], fromMe })) {
      return { role: 'owner', user: null };
    }
    // Check cache first
    const cached = this._cache.get(jid);
    if (cached && cached.expiresAt > Date.now()) return { role: cached.role, user: cached.user };

    const user = await this.users.get(jid);
    let role;
    if (user?.banned) role = 'banned';
    else if (user?.role === 'admin') role = 'admin';
    else if (this.config.bot.mode === 'public' || user?.allowed) role = 'user';
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
