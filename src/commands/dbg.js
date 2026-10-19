import { UserError } from '../utils/errors.js';
import { describeMessage } from '../utils/message.js';
import { normalizeJid, isPnJid, isLidJid, resolveSender, numberToJid } from '../utils/jid.js';

/**
 * ,dbg <command>
 * Owner-only diagnostic tool. Runs a series of checks relevant to the named command
 * and reports findings in plain text so you can spot the issue immediately.
 */
export default {
  name: 'dbg',
  aliases: ['debug'],
  description: 'Run diagnostics for a command',
  usage: 'dbg <command>  — e.g. ,dbg vv',
  role: 'owner',

  async execute(ctx) {
    const target = ctx.args[0]?.toLowerCase();
    if (!target) throw new UserError('Usage: ,dbg <command>  e.g. ,dbg vv');

    const lines = [`🔬 *Debug: ,${target}*`, ''];

    switch (target) {
      case 'vv':
        await diagnoseVv(ctx, lines);
        break;
      case 'welcome':
        await diagnoseWelcome(ctx, lines);
        break;
      default:
        await diagnoseGeneric(target, ctx, lines);
        break;
    }

    await ctx.reply(lines.join('\n'));
  },
};

// ─── ,vv diagnostics ──────────────────────────────────────────────────────────

async function diagnoseVv(ctx, lines) {
  const { client, ownerJids, permissions } = ctx.deps;

  // 1. Bot identity
  const selfJid = client.selfJid ?? '(not set)';
  const selfNum = selfJid.split('@')[0];
  lines.push(`*Bot JID:* ${selfJid}`);
  lines.push(`*Bot status:* ${client.status}`);

  // 2. Owner config
  const ownerJid = ownerJids?.[0] ?? '(not configured)';
  lines.push(`*Owner JID:* ${ownerJid}`);

  // 3. Self-send loop risk: if bot number == owner number
  if (selfJid !== '(not set)' && ownerJid !== '(not configured)') {
    const selfNum2 = normalizeJid(selfJid).split('@')[0];
    const ownerNum = ownerJid.split('@')[0];
    if (selfNum2 === ownerNum) {
      lines.push(`⚠️  *Self-send loop risk:* Bot number and owner number are the same (${ownerNum}). View-once forwards may echo back.`);
    } else {
      lines.push(`✅  Bot ≠ owner — no self-send loop risk`);
    }
  }

  // 4. Quoted message check
  const quoted = ctx.quoted;
  if (!quoted) {
    lines.push('');
    lines.push('ℹ️  *No quoted message* — reply to a view-once to get full ,vv diagnostics.');
  } else {
    const info = describeMessage(quoted.message);
    lines.push('');
    lines.push(`*Quoted kind:* ${info.kind}`);
    lines.push(`*viewOnce flag:* ${info.viewOnce}`);
    lines.push(`*hasMedia:* ${info.hasMedia}`);

    if (!info.viewOnce) lines.push('⚠️  Quoted message is NOT a view-once — ,vv would reject it');
    if (!info.hasMedia) lines.push('⚠️  Quoted message has NO media — ,vv would reject it');

    // 5. Sender JID type check (LID vs PN)
    const rawParticipant = quoted.participant ?? null;
    const rawChatJid = ctx.chatJid;
    const fakeKey = { remoteJid: rawChatJid, participant: rawParticipant, participantAlt: null, remoteJidAlt: null };
    const resolved = resolveSender(fakeKey, { selfJid: client.selfJid });

    lines.push('');
    lines.push(`*Raw participant JID:* ${rawParticipant ?? '(none — DM)'}`);
    lines.push(`*Resolved sender JID:* ${resolved.jid || '(unresolved)'}`);

    const isLid = resolved.jid ? isLidJid(resolved.jid) : false;
    const isPn = resolved.jid ? isPnJid(resolved.jid) : false;

    if (isLid) {
      lines.push(`⚠️  *Sender is a LID JID* — caption would show an internal ID, not a phone number.`);
      lines.push(`   Fix: The patch in viewonce.js/vv.js now uses resolveSender which checks *Alt fields.`);
      lines.push(`   If this message shows LID after the patch, the *Alt fields are also LID — WhatsApp hasn't resolved the phone yet.`);
    } else if (isPn) {
      lines.push(`✅  Sender is a phone-number JID — caption will show the real number (+${resolved.jid.split('@')[0]})`);
    } else {
      lines.push(`❓  Sender JID type unknown: ${resolved.jid}`);
    }

    // 6. mimetype
    if (info.mimetype) lines.push(`*Mimetype:* ${info.mimetype}`);
  }

  // 7. Connection health
  lines.push('');
  lines.push(`*Connection state:* ${client.status}`);
  if (client.status !== 'open') {
    lines.push(`⚠️  Bot is NOT connected — ,vv will fail with "connection not open"`);
  } else {
    lines.push(`✅  Connection is open`);
  }
}

// ─── Welcome diagnostics ───────────────────────────────────────────────────────

async function diagnoseWelcome(ctx, lines) {
  const { deps } = ctx;
  const settings = deps.settings;

  lines.push(`*Bot mode:* ${settings?.botMode ?? deps.config?.bot?.mode ?? '(unknown)'}`);
  lines.push(`*Prefix:* ${settings?.prefix ?? '(unknown)'}`);

  // Check if welcome is even a registered command
  const welcomeCmd = deps.registry?.get?.('welcome');
  if (!welcomeCmd) {
    lines.push(`ℹ️  No ,welcome command registered — welcome is handled by an event hook, not a command.`);
  } else {
    lines.push(`✅  Welcome command found, role: ${welcomeCmd.role ?? 'user'}`);
  }

  lines.push('');
  lines.push('Common causes of missing welcome messages:');
  lines.push('• User messaged while bot was offline — event never fired');
  lines.push('• User JID resolved as LID on first contact — role check may have failed');
  lines.push("• Bot mode is 'private' and user isn't whitelisted — message silently ignored");
  lines.push('• User was already in DB from a previous session');
}

// ─── Generic command diagnostics ──────────────────────────────────────────────

async function diagnoseGeneric(target, ctx, lines) {
  const { registry, permissions } = ctx.deps;

  const cmd = registry?.get(target);
  if (!cmd) {
    lines.push(`❌  Command *,${target}* is not registered.`);
    lines.push(`Tip: check the filename in src/commands/ matches the name/aliases in the command file.`);
    return;
  }

  lines.push(`✅  Command found`);
  lines.push(`*Name:* ${cmd.name}`);
  lines.push(`*Aliases:* ${cmd.aliases?.join(', ') || '(none)'}`);
  lines.push(`*Required role:* ${cmd.role ?? 'user'}`);
  lines.push(`*Group only:* ${cmd.groupOnly ? 'yes' : 'no'}`);
  lines.push(`*DM only:* ${cmd.dmOnly ? 'yes' : 'no'}`);
  lines.push(`*Open (no auth):* ${cmd.open ? 'yes' : 'no'}`);

  // Check caller's own role against the command's requirement
  const { hasRole } = await import('../services/permissions.js');
  const callerRole = ctx.role;
  const passes = hasRole(callerRole, cmd.role ?? 'user');
  lines.push('');
  lines.push(`*Your role:* ${callerRole}`);
  lines.push(passes ? `✅  You have permission to run ,${target}` : `⚠️  Your role (${callerRole}) does not satisfy required role (${cmd.role ?? 'user'})`);

  // Chat context
  lines.push('');
  lines.push(`*Running in:* ${ctx.isGroup ? 'group' : 'DM'}`);
  if (cmd.groupOnly && !ctx.isGroup) lines.push(`⚠️  ,${target} is group-only but you are in a DM`);
  if (cmd.dmOnly && ctx.isGroup) lines.push(`⚠️  ,${target} is DM-only but you are in a group`);
}
