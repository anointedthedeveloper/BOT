import { UserError } from '../utils/errors.js';

export default {
  name: 'quote',
  description: 'Get a random motivational quote',
  usage: 'quote',
  async execute(ctx) {
    let data;
    try {
      const res = await fetch('https://zenquotes.io/api/random');
      if (!res.ok) throw new Error('bad response');
      data = await res.json();
    } catch {
      throw new UserError('Could not fetch a quote right now, try again later.');
    }
    const q = data?.[0];
    if (!q?.q || !q?.a) throw new UserError('Could not fetch a quote right now, try again later.');
    await ctx.reply(`💬 _"${q.q}"_\n\n— *${q.a}*`);
  },
};
