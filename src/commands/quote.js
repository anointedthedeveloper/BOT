import { UserError } from '../utils/errors.js';

export default {
  name: 'quote',
  description: 'Get a random motivational quote',
  usage: 'quote',
  async execute(ctx) {
    let data;
    try {
      const res = await fetch('https://api.quotable.io/random?tags=motivational|inspirational|success');
      if (!res.ok) throw new Error('bad response');
      data = await res.json();
    } catch {
      throw new UserError('Could not fetch a quote right now, try again later.');
    }
    await ctx.reply(`💬 _"${data.content}"_\n\n— *${data.author}*`);
  },
};
