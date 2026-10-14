// Fast syntax check of every source file: `npm run check`.
import { readdirSync, statSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';

const walk = (d) => readdirSync(d).flatMap((f) => {
  const p = path.join(d, f);
  return statSync(p).isDirectory() ? walk(p) : p.endsWith('.js') ? [p] : [];
});
let failed = 0;
for (const f of [...walk('src'), ...walk('scripts'), ...walk('test')]) {
  const r = spawnSync(process.execPath, ['--check', f], { encoding: 'utf8' });
  if (r.status !== 0) { failed++; console.error(r.stderr); }
}
if (failed) process.exit(1);
console.log('syntax ok');
