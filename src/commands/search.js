import { UserError } from '../utils/errors.js';
import { ITEM_TYPES } from '../database/items.js';
import { splitArgs } from '../utils/text.js';
import { TYPE_LABEL, formatItemLine } from './_items.js';

export default {
  name: 'search',
  aliases: ['find'],
  category: 'Saved content',
  description: 'Search your saved notes, bookmarks and messages',
  usage: 'search <words> [type:note|bookmark|saved] [#tag]',
  details: 'Only searches content you saved yourself. Every word must match.',
  async execute(ctx) {
    const { items } = ctx.deps;
    const terms = [];
    let type;
    let tag;
    for (const tok of splitArgs(ctx.argText)) {
      const t = tok.match(/^type:(\w+)$/i);
      if (t) {
        type = t[1].toLowerCase();
        if (!ITEM_TYPES.includes(type)) throw new UserError(`type must be one of: ${ITEM_TYPES.join(', ')}.`);
      } else if (/^#[\p{L}\p{N}_-]+$/u.test(tok)) tag = tok.slice(1);
      else terms.push(tok);
    }
    if (!terms.length && !tag) throw new UserError(`Usage: ${ctx.prefix}${this.usage}`);

    const results = await items.search(ctx.sender.jid, { terms, type, tag, limit: 10 });
    if (!results.length) return ctx.reply('No matches in your saved content.');
    await ctx.reply([
      `🔎 ${results.length} result${results.length > 1 ? 's' : ''}`,
      ...results.map((r) => `${formatItemLine(r.item, ctx.user.prefs.timezone)}\n   ${TYPE_LABEL[r.item.type]} · ${r.snippet}`),
      '',
      `Open one with ${ctx.prefix}note show #n, ${ctx.prefix}save show #n or ${ctx.prefix}bookmark show #n.`,
    ].join('\n'));
  },
};
