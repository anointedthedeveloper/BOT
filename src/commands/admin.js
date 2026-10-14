import { UserError } from '../utils/errors.js';
import { getContextInfo } from '../utils/message.js';
import { normalizeJid, parseUserInput, jidNumber } from '../utils/jid.js';
import { formatDate } from '../utils/text.js';

const OWNER_ONLY = new Set(['promote', 'demote', 'prefix', 'botname', 'identity-reset']);

export default {
  name: 'admin',
  category: 'Administration',
  description: 'Manage users and bot identity',
  usage: 'admin <ban|unban|allow|disallow|list|stats> … | owner: promote|demote|prefix|botname|identity-reset',
  role: 'admin',
  details: [
    '{p}admin allow <number|@mention> – let someone use the bot (private mode)',
    '{p}admin disallow <number>',
    '{p}admin ban <number> [reason] / unban <number>',
    '{p}admin list – admins, allowed and banned users',
    '{p}admin stats – usage counters',
    'Owner only:',
    '{p}admin promote|demote <number> – grant/revoke admin',
    '{p}admin prefix <new> · botname <name> · identity-reset',
  ].join('\n'),
  async execute(ctx) {
    const { users, permissions, settings, chats, messageCache, errorReporter } = ctx.deps;
    const sub = (ctx.args[0] ?? '').toLowerCase();
    if (!sub) throw new UserError(`Usage: ${ctx.prefix}${this.usage}`);
    if (OWNER_ONLY.has(sub) && ctx.role !== 'owner') throw new UserError('Only the bot owner can do that.');

    const resolveTarget = () => {
      const mentioned = getContextInfo(ctx.msg.message)?.mentionedJid?.[0];
      const jid = mentioned ? normalizeJid(mentioned) : parseUserInput(ctx.args[1]);
      if (!jid) throw new UserError('Give a phone number in international format (digits only) or @mention someone.');
      return jid;
    };
    const guardPrivileged = (jid) => {
      if (permissions.isOwner({ candidates: [jid] })) throw new UserError('The owner cannot be modified.');
    };

    switch (sub) {
      case 'allow':
      case 'disallow': {
        const jid = resolveTarget();
        await users.setAllowed(jid, sub === 'allow');
        return ctx.reply(`✅ +${jidNumber(jid) || jid} ${sub === 'allow' ? 'can now use' : 'can no longer use'} the bot${ctx.deps.config.bot.mode === 'public' ? ' (note: BOT_MODE=public lets everyone use it)' : ''}.`);
      }
      case 'ban': {
        const jid = resolveTarget();
        guardPrivileged(jid);
        const target = await users.get(jid);
        if (target?.role === 'admin' && ctx.role !== 'owner') throw new UserError('Only the owner can ban an admin.');
        const reason = ctx.args.slice(2).join(' ').slice(0, 200) || null;
        await users.setBanned(jid, true, reason);
        return ctx.reply(`🔨 +${jidNumber(jid) || jid} is banned.`);
      }
      case 'unban': {
        const jid = resolveTarget();
        await users.setBanned(jid, false);
        return ctx.reply(`✅ +${jidNumber(jid) || jid} is unbanned.`);
      }
      case 'promote':
      case 'demote': {
        const jid = resolveTarget();
        guardPrivileged(jid);
        await users.setRole(jid, sub === 'promote' ? 'admin' : 'user');
        return ctx.reply(`✅ +${jidNumber(jid) || jid} is now ${sub === 'promote' ? 'an admin' : 'a regular user'}.`);
      }
      case 'list': {
        const rows = await users.listPrivileged();
        if (!rows.length) return ctx.reply('No admins, allowed or banned users.');
        const label = (u) => `+${jidNumber(u.jid) || u.jid}`;
        return ctx.reply(rows.map((u) => `${u.banned ? '🔨' : u.role === 'admin' ? '🛡️' : '✅'} ${label(u)} — ${u.banned ? `banned${u.banReason ? ` (${u.banReason})` : ''}` : u.role === 'admin' ? 'admin' : 'allowed'}`).join('\n'));
      }
      case 'stats': {
        return ctx.reply([
          '*Stats*',
          `Users: ${await users.count()}`,
          `Archived chats: ${await chats.countArchived()}`,
          `Cached messages: ${await messageCache.count()}`,
          `Errors since start: ${errorReporter.total}`,
          ...errorReporter.recent.slice(-3).map((e) => `  • ${e.ref} ${formatDate(e.at)} ${e.scope}: ${e.message}`),
        ].join('\n'));
      }
      case 'prefix': {
        const next = ctx.args[1];
        if (!next) throw new UserError(`Current prefix: ${settings.prefix}`);
        try {
          await settings.setPrefix(next);
        } catch (e) {
          throw new UserError(e.message);
        }
        return ctx.reply(`✅ Prefix is now ${next} (try ${next}menu).`);
      }
      case 'botname': {
        const name = ctx.args.slice(1).join(' ');
        try {
          await settings.setBotName(name);
        } catch (e) {
          throw new UserError(e.message);
        }
        return ctx.reply(`✅ Bot name is now ${settings.botName}.`);
      }
      case 'identity-reset':
        await settings.reset();
        return ctx.reply(`✅ Prefix and bot name restored to configured defaults (${settings.prefix}).`);
      default:
        throw new UserError(`Unknown option. Try ${ctx.prefix}help admin`);
    }
  },
};
