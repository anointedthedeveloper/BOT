export const PREFIX_PATTERN = /^[^\s\p{L}\p{N}]{1,3}$/u;

/**
 * Runtime identity settings. Environment variables provide the defaults and the owner can
 * override prefix / bot name at runtime (persisted in MongoDB).
 */
export class RuntimeSettings {
  constructor(config, botConfigRepo) {
    this.config = config;
    this.repo = botConfigRepo;
    this.overrides = {};
  }

  async load() {
    this.overrides = (await this.repo.get()) ?? {};
    return this;
  }

  get prefix() {
    return this.overrides.prefix ?? this.config.bot.prefix;
  }

  get botName() {
    return this.overrides.botName ?? this.config.bot.name;
  }

  async setPrefix(prefix) {
    if (!PREFIX_PATTERN.test(prefix)) throw new Error('Prefix must be 1-3 symbol characters (no letters, digits or spaces), e.g. / ! . #');
    await this.repo.set({ prefix });
    this.overrides.prefix = prefix;
  }

  async setBotName(name) {
    const clean = String(name).trim().slice(0, 40);
    if (!clean) throw new Error('Bot name cannot be empty');
    await this.repo.set({ botName: clean });
    this.overrides.botName = clean;
  }

  async reset() {
    await this.repo.unset('prefix', 'botName');
    this.overrides = {};
  }
}
