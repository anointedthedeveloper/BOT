/**
 * Resolves the command, the sender's role and (for allowed senders) ensures a user row exists.
 * Banned senders and – in private mode – unknown senders are ignored without any reply.
 * "open" commands (privacy opt-outs) stay available to unknown senders but not to banned ones.
 */
export function identity({ registry, permissions, users }) {
  return async (ctx, next) => {
    ctx.command = registry.get(ctx.name);
    const { role, user } = await permissions.resolve({ jid: ctx.sender.jid, candidates: ctx.sender.candidates, fromMe: ctx.fromMe });
    ctx.role = role;
    ctx.user = user;
    if (role === 'banned') return;
    if (role === 'none' && !ctx.command?.open) return;
    if (!ctx.command) {
      if (role === 'none') return;
      return ctx.reply(`Unknown command "${ctx.name}". Send ${ctx.prefix}menu to see what I can do.`);
    }
    if (!ctx.user) ctx.user = await users.ensure(ctx.sender.jid);
    return next();
  };
}
