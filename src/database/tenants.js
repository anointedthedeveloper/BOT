export class TenantsRepository {
  constructor(db) {
    this.col = db.collection('tenants');
  }

  async ensureIndexes() {
    await this.col.createIndex({ phone: 1 }, { unique: true });
  }

  async create(phone) {
    const doc = { phone, status: 'pending', createdAt: new Date(), settings: {} };
    await this.col.insertOne(doc);
    return doc;
  }

  async get(phone) {
    return this.col.findOne({ phone });
  }

  async list() {
    return this.col.find({}).toArray();
  }

  async setStatus(phone, status) {
    await this.col.updateOne({ phone }, { $set: { status, updatedAt: new Date() } });
  }

  async updateSettings(phone, settings) {
    await this.col.updateOne({ phone }, { $set: { settings, updatedAt: new Date() } });
  }

  async delete(phone) {
    await this.col.deleteOne({ phone });
  }
}
