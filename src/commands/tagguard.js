import { setTagGuard, isTagGuardEnabled } from '../services/tagAllGuard.js';
import { normalizeJid } from '../utils/jid.js';

export default {
  name: 'tagguard',
  aliases: ['tg'],
  description: 'Enable/disable @all protection for this group (admin only)',
  usage: 'tagguard on|off|status',
  role: 'user',
  async execute(ctx) {
    if (!ctx.isGroup) return ctx.reply('❌ Group only.');

    let meta;
    try {
      meta = await ctx.deps.client.rawSock.groupMetadata(ctx.chatJid);
    } catch {
      return ctx.reply('❌ Could not fetch group info.');
    }

    const senderJid = normalizeJid(ctx.msg.key.participant ?? ctx.msg.key.remoteJid);
    const senderNum = senderJid.split('@')[0];
    const member = (meta.participants ?? []).find((p) => {
      const pNum = normalizeJid(p.id).split('@')[0];
      return pNum === senderNum;
    });
    const isAdmin = ctx.role === 'owner' || member?.admin === 'admin' || member?.admin === 'superadmin';
    if (!isAdmin) return ctx.reply('❌ Only group admins can change this setting.');

    const arg = ctx.args[0]?.toLowerCase();
    const { db } = ctx.deps;

    if (arg === 'on') {
      await setTagGuard(ctx.chatJid, true, db);
      return ctx.reply('✅ @all guard *enabled*. Non-admins who use @all will be warned (7 strikes in 30 mins = kick).');
    }
    if (arg === 'off') {
      await setTagGuard(ctx.chatJid, false, db);
      return ctx.reply('🔕 @all guard *disabled*.');
    }

    const on = await isTagGuardEnabled(ctx.chatJid, db);
    return ctx.reply(`ℹ️ @all guard is currently *${on ? 'ON' : 'OFF'}* in this group.\nUse \`,tagguard on\` or \`,tagguard off\` to change it.`);
  },
};
