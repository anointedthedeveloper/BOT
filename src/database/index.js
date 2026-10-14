import { ensureIndexes } from './connection.js';
import { UsersRepository } from './users.js';
import { ChatsRepository } from './chats.js';
import { ItemsRepository } from './items.js';
import { MessageCacheRepository } from './messageCache.js';
import { BotConfigRepository } from './botConfig.js';

export { connectDatabase, ensureIndexes } from './connection.js';
export { useMongoAuthState } from './authState.js';

/** Wires every repository to one database handle. */
export async function createRepositories(db, config, cipher) {
  await ensureIndexes(db);
  const users = new UsersRepository(db, { defaultRetentionDays: config.privacy.defaultRetentionDays });
  return {
    users,
    chats: new ChatsRepository(db),
    items: new ItemsRepository(db, { users, cipher }),
    messageCache: new MessageCacheRepository(db, { cipher, ttlHours: config.privacy.cacheTtlHours }),
    botConfig: new BotConfigRepository(db),
  };
}
