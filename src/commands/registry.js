import { readdir } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';

const COMMAND_DIR = path.dirname(fileURLToPath(import.meta.url));

export class CommandRegistry {
  constructor() {
    this.commands = new Map(); // name or alias -> command
    this.unique = [];
  }

  register(cmd) {
    for (const field of ['name', 'description', 'execute']) {
      if (!cmd?.[field]) throw new Error(`Command is missing "${field}": ${JSON.stringify(cmd?.name)}`);
    }
    const names = [cmd.name, ...(cmd.aliases ?? [])].map((n) => n.toLowerCase());
    for (const n of names) if (this.commands.has(n)) throw new Error(`Duplicate command name or alias: ${n}`);
    for (const n of names) this.commands.set(n, cmd);
    this.unique.push(cmd);
    return this;
  }

  get(name) {
    return this.commands.get(String(name).toLowerCase()) ?? null;
  }

  /** Commands visible to a role, grouped by category. */
  list(hasRole, role) {
    return this.unique.filter((c) => hasRole(role, c.role ?? 'user') || c.open);
  }

  /** Loads every `*.js` command module in this directory (files starting with "_" are helpers). */
  static async load(dir = COMMAND_DIR) {
    const registry = new CommandRegistry();
    const files = (await readdir(dir)).filter((f) => f.endsWith('.js') && !f.startsWith('_') && !['registry.js', 'router.js', 'index.js'].includes(f)).sort();
    for (const f of files) registry.register((await import(pathToFileURL(path.join(dir, f)).href)).default);
    return registry;
  }
}
