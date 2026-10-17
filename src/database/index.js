import { ensureIndexes } from './connection.js';
import { UsersRepository } from './users.js';
import { ChatsRepository } from './chats.js';
import { MessageCacheRepository } from './messageCache.js';
import { BotConfigRepository } from './botConfig.js';
import { TenantsRepository } from './tenants.js';

export { connectDatabase, ensureIndexes } from './connection.js';
export { useMongoAuthState } from './authState.js';
export { TenantsRepository } from './tenants.js';

/** Wires every repository to one database handle. */
export async function createRepositories(db, config, cipher) {
  await ensureIndexes(db);
  return {
    users: new UsersRepository(db),
    chats: new ChatsRepository(db),
    messageCache: new MessageCacheRepository(db, { cipher, ttlHours: config.privacy.cacheTtlHours }),
    botConfig: new BotConfigRepository(db),
  };
}
