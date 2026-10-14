import http from 'node:http';

/**
 * Minimal health endpoint:
 *   GET /healthz -> 200 while the process is alive
 *   GET /readyz  -> 200 only when MongoDB is reachable and WhatsApp is connected, else 503
 * Responses contain no identifiers, credentials or message data.
 */
export function createHealthServer({ getStatus, logger }) {
  const server = http.createServer(async (req, res) => {
    const send = (code, body) => {
      res.writeHead(code, { 'content-type': 'application/json', 'cache-control': 'no-store' });
      res.end(JSON.stringify(body));
    };
    if (req.method !== 'GET') return send(405, { error: 'method not allowed' });
    try {
      const url = new URL(req.url, 'http://localhost').pathname;
      if (url === '/healthz') return send(200, { status: 'ok' });
      if (url === '/readyz') {
        const s = await getStatus();
        const ready = s.mongo && s.whatsapp === 'open';
        return send(ready ? 200 : 503, { status: ready ? 'ready' : 'not_ready', ...s });
      }
      return send(404, { error: 'not found' });
    } catch (err) {
      logger?.error({ err }, 'health check failed');
      return send(500, { status: 'error' });
    }
  });

  return {
    server,
    start: (port, host) =>
      new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(port, host, () => {
          server.off('error', reject);
          resolve(server.address());
        });
      }),
    stop: () => new Promise((resolve) => (server.listening ? server.close(() => resolve()) : resolve())),
  };
}
