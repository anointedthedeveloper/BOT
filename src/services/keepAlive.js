/**
 * Pings the bot's own /healthz every 14 minutes to prevent Render free tier spin-down.
 * Only runs when a PUBLIC_URL env var is set (set it to your Render service URL).
 */
export function startKeepAlive(logger, intervalMs = 14 * 60 * 1000) {
  const url = process.env.PUBLIC_URL;
  if (!url) return { stop: () => {} };

  const ping = () =>
    fetch(`${url}/healthz`).catch((err) => logger?.warn({ err: err.message }, 'keep-alive ping failed'));

  const timer = setInterval(ping, intervalMs);
  timer.unref();
  logger?.info({ url, intervalMs }, 'keep-alive started');
  return { stop: () => clearInterval(timer) };
}
