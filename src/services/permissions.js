import { isPnJid, jidNumber } from '../utils/jid.js';

export const ROLE_LEVEL = Object.freeze({ banned: -1, none: 0, user: 1, admin: 2, owner: 3 });

export const hasRole = (role, required) => (ROLE_LEVEL[role] ?? 0) >= (ROLE_LEVEL[required] ?? 99);

/**
 * Resolves a sender's effective role.
 *  - owner:  listed in OWNER_NUMBERS (config only, never granted through the database),
 *            or a message sent from the linked account itself (`fromMe`).
 *  - admin:  promoted by the owner via /admin promote.
 *  - user:   anyone in BOT_MODE=public, or users the owner/admins allowed in private mode.
 *  - none:   private mode and not allowed. The bot ignores them (except "open" commands).
 *  - banned: blocked by an admin.
 */
export class PermissionService {
  constructor({ config, users }) {
    this.config = config;
    this.users = users;
    this.ownerIds = new Set(config.owners);
  }

  isOwner({ candidates = [], fromMe = false }) {
    if (fromMe) return true;
    return candidates.some((c) => this.ownerIds.has(c) || (isPnJid(c) && this.ownerIds.has(jidNumber(c))));
  }

  async resolve({ jid, candidates, fromMe }) {
    if (this.isOwner({ candidates: candidates.length ? candidates : [jid], fromMe })) {
      return { role: 'owner', user: null };
    }
    const user = await this.users.get(jid);
    if (user?.banned) return { role: 'banned', user };
    if (user?.role === 'admin') return { role: 'admin', user };
    if (this.config.bot.mode === 'public' || user?.allowed) return { role: 'user', user };
    return { role: 'none', user };
  }
}
