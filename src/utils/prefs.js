import { UserError } from './errors.js';
import { isValidTimeZone } from './text.js';

const parseBool = (key, raw) => {
  const v = String(raw).toLowerCase();
  if (['on', 'true', 'yes', '1', 'enable', 'enabled'].includes(v)) return true;
  if (['off', 'false', 'no', '0', 'disable', 'disabled'].includes(v)) return false;
  throw new UserError(`"${key}" expects on or off.`);
};

/** Preferences a user can change with /settings. */
export const SETTINGS_SCHEMA = {
  notifyDeletes: { description: 'Get a message when a deleted message is detected in chats you archived', parse: (r) => parseBool('notifyDeletes', r) },
  ackReactions: { description: 'React with ✅ to commands that succeed', parse: (r) => parseBool('ackReactions', r) },
  timezone: {
    description: 'IANA timezone for dates, e.g. Africa/Lagos',
    parse: (r) => {
      if (!isValidTimeZone(r)) throw new UserError(`"${r}" is not a valid IANA timezone (example: Europe/London).`);
      return r;
    },
  },
};

export function parseRetentionDays(raw, max) {
  if (['off', 'never', 'forever'].includes(String(raw).toLowerCase())) return 0;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 0 || n > max) throw new UserError(`Retention must be a whole number of days from 0 (keep until I delete) to ${max}.`);
  return n;
}

export { parseBool };
