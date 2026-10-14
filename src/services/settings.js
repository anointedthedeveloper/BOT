export const PREFIX_PATTERN = /^[^\s\p{L}\p{N}]{1,3}$/u;
const ARCHIVE_MODES = ['off', 'meta', 'full', 'media'];
const ARCHIVE_TARGETS = ['inchat', 'dm'];

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

  /** Archive mode a chat starts in until someone configures it explicitly (see /delete and DEFAULT_ARCHIVE_MODE). */
  get defaultArchiveMode() {
    return this.overrides.defaultArchiveMode ?? this.config.privacy.defaultArchiveMode;
  }

  async setDefaultArchiveMode(mode) {
    if (!ARCHIVE_MODES.includes(mode)) throw new Error(`Mode must be one of: ${ARCHIVE_MODES.join(', ')}`);
    if (mode === 'full' && !this.config.privacy.allowContentLogging) throw new Error('Content logging is disabled by the operator (ALLOW_CONTENT_LOGGING=false).');
    if (mode === 'media' && !this.config.privacy.allowMediaCaching) throw new Error('Media caching is disabled by the operator (ALLOW_MEDIA_CACHING=false).');
    await this.repo.set({ defaultArchiveMode: mode });
    this.overrides.defaultArchiveMode = mode;
  }

  /**
   * Where a DEFAULT-activated chat's deletion recovery is shown: 'inchat' (posted back in the
   * chat it happened in — the default) or 'dm' (sent privately to the owner instead). Either way
   * the chat still gets the same visible "archiving is ON" notice the first time it applies —
   * this setting only changes where the *recovered content* ends up, never whether the chat is
   * told archiving is happening.
   */
  get defaultArchiveTarget() {
    return this.overrides.defaultArchiveTarget ?? 'inchat';
  }

  async setDefaultArchiveTarget(target) {
    if (!ARCHIVE_TARGETS.includes(target)) throw new Error(`Target must be one of: ${ARCHIVE_TARGETS.join(', ')}`);
    await this.repo.set({ defaultArchiveTarget: target });
    this.overrides.defaultArchiveTarget = target;
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

  /** Resets identity only (prefix/bot name) — deliberately leaves the archive default untouched; use /delete off for that. */
  async reset() {
    await this.repo.unset('prefix', 'botName');
    delete this.overrides.prefix;
    delete this.overrides.botName;
  }
}
