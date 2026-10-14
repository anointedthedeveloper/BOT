import { hasRole } from '../services/permissions.js';
import { UserError } from '../utils/errors.js';

export default {
  name: 'help',
  aliases: ['h', '?'],
  category: 'General',
  description: 'Show usage instructions',
  usage: 'help [command]',
  async execute(ctx) {
    const { registry, settings } = ctx.deps;
    const p = ctx.prefix;
    const target = ctx.args[0]?.replace(p, '');
    if (target) {
      const cmd = registry.get(target);
      if (!cmd || !(hasRole(ctx.role, cmd.role ?? 'user') || cmd.open)) throw new UserError(`No command named "${target}".`);
      const lines = [`*${p}${cmd.name}* — ${cmd.description}`, `Usage: ${p}${cmd.usage ?? cmd.name}`];
      if (cmd.aliases?.length) lines.push(`Aliases: ${cmd.aliases.map((a) => p + a).join(', ')}`);
      if (cmd.details) lines.push('', cmd.details.replaceAll('{p}', p));
      if ((cmd.role ?? 'user') !== 'user') lines.push(`Requires: ${cmd.role}`);
      return ctx.reply(lines.join('\n'));
    }
    await ctx.reply([
      `*${settings.botName}* help`,
      `Send commands starting with *${p}*, e.g. ${p}ping.`,
      '',
      '*Saving things*',
      `• Reply to a message with ${p}save, ${p}bookmark or ${p}search later to find it again.`,
      `• ${p}note <text> keeps a personal note. Add #tags to organise.`,
      '',
      '*Privacy*',
      '• The bot stores nothing from a chat unless archiving was switched on for it, and that is announced in the chat.',
      `• ${p}privacy shows and controls what is stored about you.`,
      '• View-once messages are never saved.',
      '',
      `${p}menu lists every command; ${p}help <command> explains one.`,
    ].join('\n'));
  },
};
