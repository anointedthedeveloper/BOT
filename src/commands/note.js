import { UserError } from '../utils/errors.js';
import { extractTags, truncate } from '../utils/text.js';
import { handleItemSubcommand } from './_items.js';

export default {
  name: 'note',
  aliases: ['notes'],
  category: 'Saved content',
  description: 'Keep personal notes',
  usage: 'note <text> | note list [page] | note show <#> | note delete <#>',
  details: 'Add #tags inside a note to organise it, then find it with {p}search #tag.',
  async execute(ctx) {
    const [sub, ...rest] = ctx.args;
    if (!sub) throw new UserError(`Usage: ${ctx.prefix}${this.usage}`);
    if (await handleItemSubcommand(ctx, 'note', sub.toLowerCase(), rest)) return;

    const { items, config } = ctx.deps;
    const text = ctx.argText.replace(/^add\s+/i, '').trim();
    if (!text) throw new UserError('Write the note after the command.');
    if (text.length > 4000) throw new UserError('Notes are limited to 4000 characters.');
    if ((await items.count(ctx.sender.jid)) >= config.media.maxItemsPerUser) throw new UserError('You reached the item limit. Delete something first.');
    const item = await items.create(ctx.sender.jid, { type: 'note', text, tags: extractTags(text), retentionDays: ctx.user.prefs.retentionDays });
    await ctx.reply(`📝 Saved as *#${item.seq}*: ${truncate(text, 80)}`);
  },
};
