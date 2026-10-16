import http from 'node:http';
import qrcode from 'qrcode';

/**
 * Minimal health endpoint:
 *   GET /healthz -> 200 while the process is alive
 *   GET /readyz  -> 200 only when MongoDB is reachable and WhatsApp is connected, else 503
 * Responses contain no identifiers, credentials or message data.
 */
export function createHealthServer({ getStatus, logger }) {
  const server = http.createServer(async (req, res) => {
    const send = (code, body, ct = 'application/json') => {
      res.writeHead(code, { 'content-type': ct, 'cache-control': 'no-store' });
      res.end(typeof body === 'string' ? body : JSON.stringify(body));
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
      if (url === '/qr') {
        const s = await getStatus();
        if (s.whatsapp === 'open') return send(200, '<html><body style="font-family:sans-serif;text-align:center;padding:2rem"><h2>✅ Already connected</h2></body></html>', 'text/html');
        const qr = s.qr;
        if (!qr) return send(200, '<html><body style="font-family:sans-serif;text-align:center;padding:2rem"><h2>⏳ Waiting for QR code...</h2><p>Refresh in a few seconds.</p><script>setTimeout(()=>location.reload(),4000)</script></body></html>', 'text/html');
        const dataUrl = await qrcode.toDataURL(qr, { width: 300, margin: 2 });
        return send(200, `<html><body style="font-family:sans-serif;text-align:center;padding:2rem"><h2>Scan QR Code</h2><img src="${dataUrl}" style="max-width:300px"/><p>Refreshes automatically every 30s</p><script>setTimeout(()=>location.reload(),30000)</script></body></html>`, 'text/html');
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
