import { UserError } from '../utils/errors.js';

export default {
  name: 'pair',
  description: 'Generate a pairing code for your WhatsApp number',
  usage: 'pair <phone>  — e.g. ,pair 2349012345678',
  open: true,
  async execute(ctx) {
    const { sessionManager, tenants, db, logger } = ctx.deps;
    if (!sessionManager || !tenants) throw new UserError('Pairing is not available in this mode.');

    const phone = ctx.args[0]?.replace(/\D/g, '');
    if (!phone || phone.length < 7) throw new UserError('Usage: ,pair <phone>  e.g. ,pair 2349012345678');

    // Stop any existing non-open session for this number
    const existing = sessionManager.getSession(phone);
    if (existing?.status === 'open') return ctx.reply(`✅ +${phone} is already connected.`);
    if (existing) await sessionManager.stopSession(phone);

    // Ensure tenant record exists
    const tenant = await tenants.get(phone);
    if (!tenant) {
      await tenants.create(phone);
    } else {
      await tenants.setStatus(phone, 'pending');
      try { await db.db.collection(`wa_auth_${phone}`).deleteMany({}); } catch { /* non-fatal */ }
    }

    // Start session with pairing mode
    sessionManager.startSession(phone, { pairingPhone: phone }).catch((err) =>
      logger.error({ err, phone }, 'pair session start failed')
    );

    await ctx.reply(
      `📱 *Pairing started for +${phone}*\n\n` +
      `The pairing code will appear here in a few seconds.\n` +
      `You can also check the dashboard for the code.\n\n` +
      `On your phone: *Settings › Linked Devices › Link with phone number*`
    );

    // Poll for the pairing code and send it back (up to 30s)
    let attempts = 0;
    const interval = setInterval(async () => {
      attempts++;
      const session = sessionManager.getSession(phone);
      if (!session) { clearInterval(interval); return; }

      if (session.pairingCode) {
        clearInterval(interval);
        await ctx.reply(`🔑 *Pairing Code for +${phone}*\n\n\`${session.pairingCode}\`\n\n_Enter this on WhatsApp › Linked Devices › Link with phone number_`);
        return;
      }
      if (session.pairingError) {
        clearInterval(interval);
        await ctx.reply(`❌ Pairing failed: ${session.pairingError}\n\nTry again with ,pair ${phone}`);
        return;
      }
      if (session.status === 'open') {
        clearInterval(interval);
        await ctx.reply(`✅ +${phone} connected successfully!`);
        return;
      }
      if (attempts >= 12) clearInterval(interval); // 30s timeout
    }, 2500);
  },
};
