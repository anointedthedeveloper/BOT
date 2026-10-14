/** Periodically deletes cached media files (from archived chats) whose lifetime has passed. */
export function startRetentionJob({ messageCache, mediaStore, intervalMs, logger, onError, extraSweeps = [] }) {
  let running = false;
  const runOnce = async () => {
    if (running) return { removed: 0 };
    running = true;
    try {
      const { removed, mediaPaths } = await messageCache.deleteExpiredMedia();
      if (mediaPaths.length) await mediaStore.removeMany(mediaPaths);
      for (const sweep of extraSweeps) sweep();
      if (removed) logger.info({ removed }, 'retention sweep removed expired cached media');
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
