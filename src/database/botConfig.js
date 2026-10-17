/** Owner-editable runtime overrides (prefix, bot name). Environment values are the defaults. */
export class BotConfigRepository {
  constructor(db, collection = 'bot_config') {
    this.col = db.collection(collection);
  }

  async get() {
    return (await this.col.findOne({ _id: 'settings' })) ?? {};
  }

  async set(patch) {
    await this.col.updateOne({ _id: 'settings' }, { $set: { ...patch, updatedAt: new Date() } }, { upsert: true });
  }

  async unset(...keys) {
    await this.col.updateOne({ _id: 'settings' }, { $unset: Object.fromEntries(keys.map((k) => [k, ''])) });
  }
}
