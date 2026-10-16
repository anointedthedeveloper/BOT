import { UserError } from '../utils/errors.js';

export default {
  name: 'calc',
  description: 'Calculate a math expression',
  usage: 'calc <expression>',
  async execute(ctx) {
    const expr = ctx.argText.trim();
    if (!expr) throw new UserError('Usage: ,calc 2 + 2');

    // safe eval — only allow numbers and math operators
    if (!/^[\d\s+\-*/.%^()]+$/.test(expr)) throw new UserError('Only numbers and operators ( + - * / % . () ) are allowed.');

    let result;
    try {
      // eslint-disable-next-line no-new-func
      result = Function(`"use strict"; return (${expr})`)();
    } catch {
      throw new UserError('Invalid expression.');
    }

    if (typeof result !== 'number' || !isFinite(result)) throw new UserError('Result is not a valid number.');
    await ctx.reply(`🧮 *${expr}* = *${result}*`);
  },
};
