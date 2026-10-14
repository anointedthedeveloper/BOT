import { hasRole } from '../services/permissions.js';

const CATEGORY_ORDER = ['General', 'Saved content', 'Privacy & settings', 'Administration'];

export default {
  name: 'menu',
  aliases: ['commands'],
  category: 'General',
  description: 'Show available commands',
  usage: 'menu',
  async execute(ctx) {
    const { registry, settings } = ctx.deps;
    const groups = new Map();
    for (const cmd of registry.list(hasRole, ctx.role)) {
      const cat = cmd.category ?? 'General';
      if (!groups.has(cat)) groups.set(cat, []);
      groups.get(cat).push(cmd);
    }
    const rank = (c) => (CATEGORY_ORDER.includes(c) ? CATEGORY_ORDER.indexOf(c) : CATEGORY_ORDER.length);
    const ordered = [...groups.keys()].sort((a, b) => rank(a) - rank(b));
    const lines = [`*${settings.botName}* — command menu`];
    for (const cat of ordered) {
      lines.push('', `*${cat}*`);
      for (const c of groups.get(cat)) lines.push(`${ctx.prefix}${c.name} — ${c.description}`);
    }
    lines.push('', `Use ${ctx.prefix}help <command> for details.`);
    await ctx.reply(lines.join('\n'));
  },
};
