/** Periodically deletes saved items (and their media files) whose retention period has passed. */
export function startRetentionJob({ items, messageCache, mediaStore, intervalMs, logger, onError, extraSweeps = [] }) {
  let running = false;
  const runOnce = async () => {
    if (running) return { removed: 0 };
    running = true;
    try {
      const { removed, mediaPaths } = await items.deleteExpired();
      if (mediaPaths.length) await mediaStore.removeMany(mediaPaths);
      if (messageCache) {
        const cache = await messageCache.deleteExpiredMedia();
        if (cache.mediaPaths.length) await mediaStore.removeMany(cache.mediaPaths);
      }
      for (const sweep of extraSweeps) sweep();
      if (removed) logger.info({ removed }, 'retention sweep removed expired items');
      return { removed };
    } catch (err) {
      onError?.(err, { scope: 'retention' });
      return { removed: 0, error: err };
    } finally {
      running = false;
    }
  };
  const timer = setInterval(runOnce, intervalMs);
  timer.unref();
  return { runOnce, stop: () => clearInterval(timer) };
}
