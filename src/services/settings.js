export const PREFIX_PATTERN = /^[^\s\p{L}\p{N}]{1,3}$/u;
const ARCHIVE_MODES = ['off', 'meta', 'full', 'media'];

/**
 * Runtime bot settings, persisted in MongoDB (the `bot_config` collection) so they survive a
 * restart. Environment variables provide the defaults; `,settings`/`,delete` change them live.
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

  /** Archive mode a chat starts in until it has been activated (see ,delete and DEFAULT_ARCHIVE_MODE). */
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

  /** Whether ,sticker is usable at all. Defaults to on. */
  get stickerEnabled() {
    return this.overrides.stickerEnabled ?? true;
  }

  async setStickerEnabled(enabled) {
    await this.repo.set({ stickerEnabled: Boolean(enabled) });
    this.overrides.stickerEnabled = Boolean(enabled);
  }

  /** Whether the bot automatically reads WhatsApp statuses. Defaults to off. */
  get autoViewStatus() {
    return this.overrides.autoViewStatus ?? false;
  }

  async setAutoViewStatus(enabled) {
    await this.repo.set({ autoViewStatus: Boolean(enabled) });
    this.overrides.autoViewStatus = Boolean(enabled);
  }

  get typingIndicator() {
    return this.overrides.typingIndicator ?? false;
  }

  async setTypingIndicator(enabled) {
    await this.repo.set({ typingIndicator: Boolean(enabled) });
    this.overrides.typingIndicator = Boolean(enabled);
  }

  /** Whether global admin (owner numbers from env) can use this tenant bot. Defaults true. */
  get adminUse() {
    return this.overrides.adminUse ?? true;
  }

  async setAdminUse(enabled) {
    await this.repo.set({ adminUse: Boolean(enabled) });
    this.overrides.adminUse = Boolean(enabled);
  }

  get botMode() {
    return this.overrides.botMode ?? this.config.bot.mode;
  }

  async setBotMode(mode) {
    if (!['public', 'private'].includes(mode)) throw new Error('Mode must be public or private');
    await this.repo.set({ botMode: mode });
    this.overrides.botMode = mode;
  }

  async setPrefix(prefix) {
    if (!PREFIX_PATTERN.test(prefix)) throw new Error('Prefix must be 1-3 symbol characters (no letters, digits or spaces), e.g. , ! . #');
    await this.repo.set({ prefix });
    this.overrides.prefix = prefix;
  }

  async setBotName(name) {
    const clean = String(name).trim().slice(0, 40);
    if (!clean) throw new Error('Bot name cannot be empty');
    await this.repo.set({ botName: clean });
    this.overrides.botName = clean;
  }
}
