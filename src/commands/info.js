import os from 'node:os';
import { formatBytes, formatDuration } from '../utils/text.js';

export default {
  name: 'info',
  aliases: ['status', 'about'],
  category: 'General',
  description: 'Show bot version and status',
  usage: 'info',
  async execute(ctx) {
    const { config, settings, client, db, registry } = ctx.deps;
    const lines = [
      `*${settings.botName}* v${config.version}`,
      `Status: WhatsApp ${client.status}, database ${(await db.ping()) ? 'ok' : 'unreachable'}`,
      `Uptime: ${formatDuration(process.uptime() * 1000)}`,
      `Mode: ${config.bot.mode} · Prefix: ${ctx.prefix} · Commands: ${registry.unique.length}`,
      `Encryption at rest: ${ctx.deps.cipher.enabled ? 'on' : 'off'}`,
    ];
    if (ctx.role === 'admin' || ctx.role === 'owner') {
      const { users, chats, messageCache, errorReporter } = ctx.deps;
      lines.push(
        `Node ${process.version} · RSS ${formatBytes(process.memoryUsage().rss)} · Load ${os.loadavg()[0].toFixed(2)}`,
        `Users: ${await users.count()} · Archived chats: ${await chats.countArchived()} · Cached messages: ${await messageCache.count()}`,
        `Errors since start: ${errorReporter.total}`,
      );
    }
    await ctx.reply(lines.join('\n'));
  },
};
