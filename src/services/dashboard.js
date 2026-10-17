import http from 'node:http';
import qrcode from 'qrcode';

const HTML = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>WhatsApp Bot — Connect</title>
<style>
  *{box-sizing:border-box;margin:0;padding:0}
  body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#0a0a0a;color:#e0e0e0;min-height:100vh;display:flex;align-items:center;justify-content:center;padding:1rem}
  .card{background:#111;border:1px solid #222;border-radius:16px;padding:2rem;width:100%;max-width:420px}
  h1{font-size:1.4rem;font-weight:700;margin-bottom:.25rem;color:#fff}
  p.sub{color:#666;font-size:.85rem;margin-bottom:1.5rem}
  label{display:block;font-size:.8rem;color:#888;margin-bottom:.4rem}
  input{width:100%;padding:.7rem 1rem;background:#1a1a1a;border:1px solid #333;border-radius:8px;color:#fff;font-size:.95rem;outline:none;transition:border .2s}
  input:focus{border-color:#25d366}
  .row{display:flex;gap:.75rem;margin-top:.75rem}
  button{flex:1;padding:.75rem;border:none;border-radius:8px;font-size:.9rem;font-weight:600;cursor:pointer;transition:opacity .2s}
  button:hover{opacity:.85}
  .btn-qr{background:#25d366;color:#000}
  .btn-pair{background:#1a73e8;color:#fff}
  #status{margin-top:1.25rem;padding:1rem;border-radius:10px;background:#1a1a1a;border:1px solid #222;display:none;text-align:center}
  #status.show{display:block}
  #status img{max-width:240px;margin:.75rem auto;display:block;border-radius:8px}
  .code{font-size:2rem;font-weight:700;letter-spacing:.3rem;color:#25d366;margin:.5rem 0}
  .tag{display:inline-block;padding:.2rem .6rem;border-radius:20px;font-size:.75rem;font-weight:600}
  .tag.open{background:#1a3a2a;color:#25d366}
  .tag.pending{background:#2a2a1a;color:#f0c040}
  .tag.failed{background:#3a1a1a;color:#f04040}
  .sessions{margin-top:1.5rem}
  .sessions h2{font-size:.9rem;color:#666;margin-bottom:.75rem;text-transform:uppercase;letter-spacing:.05rem}
  .session-item{display:flex;align-items:center;justify-content:space-between;padding:.6rem .75rem;background:#1a1a1a;border-radius:8px;margin-bottom:.5rem;font-size:.85rem}
  .msg{font-size:.85rem;color:#888;margin-top:.5rem}
  .msg.err{color:#f04040}
  .msg.ok{color:#25d366}
</style>
</head>
<body>
<div class="card">
  <h1>🤖 WhatsApp Bot</h1>
  <p class="sub">Connect your WhatsApp number to get your own bot instance.</p>

  <label>Your WhatsApp number (with country code, no +)</label>
  <input id="phone" type="tel" placeholder="e.g. 2349012345678" autocomplete="off"/>

  <div class="row">
    <button class="btn-qr" onclick="connect('qr')">📷 Scan QR</button>
    <button class="btn-pair" onclick="connect('pair')">🔢 Pairing Code</button>
  </div>
  <div id="msg" class="msg"></div>

  <div id="status"></div>

  <div class="sessions" id="sessions-wrap" style="display:none">
    <h2>Active Sessions</h2>
    <div id="sessions-list"></div>
  </div>
</div>

<script>
let pollTimer = null;

function showMsg(text, type='') {
  const el = document.getElementById('msg');
  el.textContent = text;
  el.className = 'msg ' + type;
}

async function connect(method) {
  const phone = document.getElementById('phone').value.trim().replace(/\\D/g,'');
  if (!phone || phone.length < 7) return showMsg('Enter a valid phone number.', 'err');
  showMsg('Connecting...', '');
  const res = await fetch('/api/signup', {
    method: 'POST',
    headers: {'content-type':'application/json'},
    body: JSON.stringify({ phone, method })
  });
  const data = await res.json();
  if (!res.ok) return showMsg(data.error || 'Failed', 'err');
  showMsg('', '');
  startPolling(phone, method);
}

function startPolling(phone, method) {
  clearInterval(pollTimer);
  pollTimer = setInterval(() => poll(phone, method), 2500);
  poll(phone, method);
}

async function poll(phone, method) {
  const res = await fetch('/api/status/' + phone);
  const data = await res.json();
  const box = document.getElementById('status');
  box.className = 'show';

  if (data.status === 'open') {
    clearInterval(pollTimer);
    box.innerHTML = '<div class="tag open">✅ Connected</div><p style="margin-top:.5rem;color:#888;font-size:.85rem">Your bot is live! Send <b>,menu</b> to your number.</p>';
    loadSessions();
    return;
  }

  if (method === 'qr' && data.qr) {
    box.innerHTML = '<p style="color:#888;font-size:.85rem;margin-bottom:.5rem">Scan with WhatsApp > Linked Devices</p><img id="qrimg" src=""/><p style="color:#555;font-size:.75rem">Auto-refreshes every 2.5s</p>';
    document.getElementById('qrimg').src = data.qr;
    return;
  }

  if (method === 'pair' && data.pairingCode) {
    box.innerHTML = '<p style="color:#888;font-size:.85rem">Enter this code on WhatsApp > Linked Devices > Link with phone number</p><div class="code">' + data.pairingCode + '</div>';
    return;
  }

  if (data.status === 'failed') {
    clearInterval(pollTimer);
    box.innerHTML = '<div class="tag failed">❌ Failed — try again</div>';
    return;
  }

  box.innerHTML = '<div class="tag pending">⏳ ' + (data.status || 'Connecting') + '...</div>';
}

async function loadSessions() {
  const res = await fetch('/api/sessions');
  const data = await res.json();
  if (!data.length) return;
  const wrap = document.getElementById('sessions-wrap');
  const list = document.getElementById('sessions-list');
  wrap.style.display = 'block';
  list.innerHTML = data.map(s =>
    '<div class="session-item"><span>+' + s.phone + '</span><span class="tag ' + s.status + '">' + s.status + '</span></div>'
  ).join('');
}

loadSessions();
</script>
</body>
</html>`;

export function createDashboard({ sessionManager, tenants, getStatus, logger }) {
  const server = http.createServer(async (req, res) => {
    const send = (code, body, ct = 'application/json') => {
      res.writeHead(code, { 'content-type': ct, 'cache-control': 'no-store' });
      res.end(typeof body === 'string' ? body : JSON.stringify(body));
    };

    const url = new URL(req.url, 'http://localhost');
    const path = url.pathname;

    // Frontend
    if (req.method === 'GET' && (path === '/fd' || path === '/fd/')) {
      return send(200, HTML, 'text/html');
    }

    // Health
    if (req.method === 'GET' && path === '/healthz') return send(200, { status: 'ok' });
    if (req.method === 'GET' && path === '/readyz') {
      const s = await getStatus();
      return send(s.mongo ? 200 : 503, s);
    }

    // API: signup
    if (req.method === 'POST' && path === '/api/signup') {
      let body = '';
      req.on('data', d => (body += d));
      await new Promise(r => req.on('end', r));
      try {
        const { phone, method } = JSON.parse(body);
        const digits = String(phone).replace(/\D/g, '');
        if (!digits || digits.length < 7) return send(400, { error: 'Invalid phone number' });
        const existing = await tenants.get(digits);
        if (!existing) await tenants.create(digits);
        const pairingPhone = method === 'pair' ? digits : null;
        sessionManager.startSession(digits, { pairingPhone }).catch(err =>
          logger.error({ err, phone: digits }, 'session start failed')
        );
        return send(200, { ok: true });
      } catch (err) {
        return send(400, { error: 'Bad request' });
      }
    }

    // API: status
    if (req.method === 'GET' && path.startsWith('/api/status/')) {
      const phone = path.split('/').pop();
      const session = sessionManager.getSession(phone);
      if (!session) return send(404, { error: 'Not found' });
      const out = { status: session.status, pairingCode: session.pairingCode ?? null, qr: null };
      if (session.qr) {
        try { out.qr = await qrcode.toDataURL(session.qr, { width: 256, margin: 1 }); } catch {}
      }
      return send(200, out);
    }

    // API: sessions list
    if (req.method === 'GET' && path === '/api/sessions') {
      return send(200, sessionManager.listSessions());
    }

    // API: stop session
    if (req.method === 'DELETE' && path.startsWith('/api/sessions/')) {
      const phone = path.split('/').pop();
      await sessionManager.stopSession(phone);
      await tenants.delete(phone);
      return send(200, { ok: true });
    }

    return send(404, { error: 'not found' });
  });

  return {
    server,
    start: (port, host) => new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(port, host, () => { server.off('error', reject); resolve(server.address()); });
    }),
    stop: () => new Promise(resolve => server.listening ? server.close(() => resolve()) : resolve()),
  };
}
