import { hasRole } from '../services/permissions.js';

/** Enforces command role requirements and group/DM restrictions. */
export function authorize({ config }) {
  return async (ctx, next) => {
    const cmd = ctx.command;
    if (!hasRole(ctx.role, cmd.role ?? 'user') && !cmd.open) {
      ctx.log.warn({ command: cmd.name, role: ctx.role }, 'permission denied');
      // Do not reveal the existence of privileged commands to ordinary users.
      if ((cmd.role ?? 'user') === 'owner' || cmd.role === 'admin') return ctx.reply('🚫 You are not allowed to use this command.');
      return;
    }
    if (ctx.isGroup && !config.bot.allowGroupCommands && ctx.role !== 'owner') return;
    if (cmd.groupOnly && !ctx.isGroup) return ctx.reply('This command only works in groups.');
    if (cmd.dmOnly && ctx.isGroup) return ctx.reply('This command only works in a private chat.');
    return next();
  };
}
