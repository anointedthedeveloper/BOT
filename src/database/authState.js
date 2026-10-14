/**
 * MongoDB-backed Baileys auth state (alternative to useMultiFileAuthState) for hosts with
 * ephemeral disks. Credentials are encrypted at rest when a cipher is supplied.
 * `baileys` is injected so this module has no hard dependency on the library.
 */
export async function useMongoAuthState(db, { baileys, cipher, collection = 'wa_auth' }) {
  const { BufferJSON, initAuthCreds, proto } = baileys;
  const col = db.collection(collection);
  const enc = (v) => cipher.encryptText(JSON.stringify(v, BufferJSON.replacer));
  const dec = (s) => JSON.parse(cipher.decryptText(s), BufferJSON.reviver);

  const read = async (id) => {
    const doc = await col.findOne({ _id: id });
    return doc ? dec(doc.value) : null;
  };

  const creds = (await read('creds')) ?? initAuthCreds();

  return {
    state: {
      creds,
      keys: {
        get: async (type, ids) => {
          const data = {};
          const docs = await col.find({ _id: { $in: ids.map((id) => `${type}-${id}`) } }).toArray();
          const byId = new Map(docs.map((d) => [d._id, d.value]));
          for (const id of ids) {
            let value = byId.has(`${type}-${id}`) ? dec(byId.get(`${type}-${id}`)) : null;
            if (type === 'app-state-sync-key' && value) value = proto.Message.AppStateSyncKeyData.fromObject(value);
            data[id] = value;
          }
          return data;
        },
        set: async (data) => {
          const ops = [];
          for (const [category, entries] of Object.entries(data)) {
            for (const [id, value] of Object.entries(entries)) {
              const _id = `${category}-${id}`;
              ops.push(value ? { updateOne: { filter: { _id }, update: { $set: { value: enc(value) } }, upsert: true } } : { deleteOne: { filter: { _id } } });
            }
          }
          if (ops.length) await col.bulkWrite(ops, { ordered: false });
        },
      },
    },
    saveCreds: async () => {
      await col.updateOne({ _id: 'creds' }, { $set: { value: enc(creds) } }, { upsert: true });
    },
    clear: () => col.deleteMany({}),
  };
}
