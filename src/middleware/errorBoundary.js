import { UserError } from '../utils/errors.js';

/** Outermost middleware: turns thrown errors into friendly replies and reports unexpected ones. */
export function errorBoundary({ errorReporter }) {
  return async (ctx, next) => {
    try {
      await next();
    } catch (err) {
      if (err instanceof UserError) {
        await ctx.reply(`⚠️ ${err.message}`).catch(() => {});
        return;
      }
      const ref = errorReporter.report(err, { scope: `command:${ctx.command?.name ?? 'unknown'}` });
      await ctx.reply(`❌ Something went wrong. Reference: ${ref}`).catch(() => {});
    }
  };
}
