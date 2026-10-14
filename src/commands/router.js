import { compose, errorBoundary, identity, rateLimit, authorize } from '../middleware/index.js';

/**
 * Routes a parsed command context through the middleware pipeline:
 *   errorBoundary -> identity (command + role) -> rateLimit -> authorize -> command.execute
 */
export class CommandRouter {
  constructor({ registry, permissions, users, limiter, errorReporter, config }) {
    this.registry = registry;
    this.run = compose([
      errorBoundary({ errorReporter }),
      identity({ registry, permissions, users }),
      rateLimit({ limiter }),
      authorize({ config }),
    ]);
  }

  async handle(ctx) {
    await this.run(ctx, async () => {
      const started = Date.now();
      await ctx.command.execute(ctx);
      ctx.log.info({ command: ctx.command.name, ms: Date.now() - started }, 'command handled');
      if (ctx.user?.prefs?.ackReactions && ctx.react) await ctx.react('✅').catch(() => {});
    });
  }
}
