import { UserError } from '../utils/errors.js';
import { SETTINGS_SCHEMA } from '../utils/prefs.js';

export default {
  name: 'settings',
  aliases: ['prefs', 'preferences'],
  category: 'Privacy & settings',
  description: 'Manage personal preferences',
  usage: 'settings [set <key> <value> | reset]',
  details: 'Keys: {p}settings shows them all.\nData-retention options live under {p}privacy.',
  async execute(ctx) {
    const { users } = ctx.deps;
    const [sub, key, ...value] = ctx.args;

    if (!sub) {
      const p = ctx.user.prefs;
      return ctx.reply([
        '*Your settings*',
        ...Object.entries(SETTINGS_SCHEMA).map(([k, s]) => `• *${k}*: ${p[k]}\n   _${s.description}_`),
        '',
        `Change with ${ctx.prefix}settings set <key> <value>. Storage & logging options: ${ctx.prefix}privacy.`,
      ].join('\n'));
    }
    if (sub === 'reset') {
      await users.resetPrefs(ctx.sender.jid);
      return ctx.reply('Settings reset to defaults.');
    }
    if (sub === 'set') {
      const schema = SETTINGS_SCHEMA[key];
      if (!schema) throw new UserError(`Unknown setting. Available: ${Object.keys(SETTINGS_SCHEMA).join(', ')}.`);
      if (!value.length) throw new UserError(`Usage: ${ctx.prefix}settings set ${key} <value>`);
      const parsed = schema.parse(value.join(' '));
      await users.setPref(ctx.sender.jid, key, parsed);
      return ctx.reply(`✅ ${key} = ${parsed}`);
    }
    throw new UserError(`Usage: ${ctx.prefix}settings [set <key> <value> | reset]`);
  },
};
