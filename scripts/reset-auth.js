// Deletes the stored WhatsApp session so a new QR code is shown on next start.
//   npm run auth:reset -- --yes
import 'dotenv/config';
import { rm } from 'node:fs/promises';
import path from 'node:path';
import { loadConfig } from '../src/config/index.js';
import { connectDatabase } from '../src/database/index.js';

if (!process.argv.includes('--yes')) {
  console.error('This logs the bot out locally and deletes its stored session.\nRe-run with --yes to confirm: npm run auth:reset -- --yes');
  process.exit(1);
}
const config = loadConfig();
if (config.auth.store === 'file') {
  await rm(path.resolve(config.auth.dir), { recursive: true, force: true });
  console.log(`Removed ${config.auth.dir}`);
} else {
  const database = await connectDatabase(config.mongo, null, { retries: 1 });
  const { deletedCount } = await database.db.collection('wa_auth').deleteMany({});
  console.log(`Removed ${deletedCount} stored session records`);
  await database.close();
}
console.log('Remove the "Linked device" entry on your phone too (WhatsApp > Settings > Linked devices).');
