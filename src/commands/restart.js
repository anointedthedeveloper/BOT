import { UserError } from '../utils/errors.js';

const CONFIRM_WINDOW_MS = 60_000;

export default {
  name: 'restart',
  category: 'Administration',
  description: 'Owner-only: restart the bot connection/process',
  usage: 'restart [confirm]',
  role: 'owner',
  details: 'Send {p}restart, then {p}restart confirm within 60 seconds.\nRESTART_MODE=reconnect recycles the WhatsApp connection; RESTART_MODE=exit shuts down gracefully so Docker/systemd/pm2 starts a fresh process.',
  async execute(ctx) {
    const { pendingRestarts, requestRestart } = ctx.deps;
    const who = ctx.sender.jid;
    const now = Date.now();

    if (ctx.args[0]?.toLowerCase() !== 'confirm') {
      pendingRestarts.set(who, now + CONFIRM_WINDOW_MS);
      return ctx.reply(`Restart requested. Send *${ctx.prefix}restart confirm* within 60 seconds to proceed.`);
    }
    const until = pendingRestarts.get(who);
    pendingRestarts.delete(who);
    if (!until || until < now) throw new UserError(`No pending request. Send ${ctx.prefix}restart first.`);

    await ctx.reply(`🔄 Restarting (${ctx.deps.config.bot.restartMode})…`);
    ctx.log.warn('owner requested restart');
    setImmediate(() => requestRestart('owner-command'));
  },
};
