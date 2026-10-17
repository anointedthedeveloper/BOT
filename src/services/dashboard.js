import http from 'node:http';
import qrcode from 'qrcode';

// SVG icon strings (no emojis)
const SVG = {
  bot:   '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="10" rx="2"/><circle cx="12" cy="5" r="2"/><line x1="12" y1="7" x2="12" y2="11"/><circle cx="8" cy="16" r="1" fill="currentColor"/><circle cx="16" cy="16" r="1" fill="currentColor"/></svg>',
  qr:    '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="3" height="3"/><line x1="17" y1="18" x2="21" y2="18"/><line x1="21" y1="14" x2="21" y2="18"/></svg>',
  pair:  '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="5" y="2" width="14" height="20" rx="2"/><circle cx="12" cy="18" r="1" fill="currentColor"/></svg>',
  check: '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>',
  warn:  '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><circle cx="12" cy="16" r="1" fill="currentColor"/></svg>',
  spin:  '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="animation:spin 1s linear infinite"><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg>',
  phone: '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 16.92v3a2 2 0 0 1-2.18 2A19.79 19.79 0 0 1 11.61 19a19.5 19.5 0 0 1-6-6A19.79 19.79 0 0 1 3.09 4.18 2 2 0 0 1 5.07 2h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L9.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 22 16.92z"/></svg>',
};

// Escape SVGs for safe inline use inside a JS string inside an HTML template
const esc = s => s.replace(/\\/g, '\\\\').replace(/'/g, "\\'");

const HTML = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>WhatsApp Bot</title>
<style>
  @keyframes spin{to{transform:rotate(360deg)}}
  *{box-sizing:border-box;margin:0;padding:0}
  body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#0a0a0a;color:#e0e0e0;min-height:100vh;display:flex;align-items:center;justify-content:center;padding:1rem}
  .card{background:#111;border:1px solid #222;border-radius:16px;padding:clamp(1.25rem,5vw,2rem);width:100%;max-width:440px}
  .brand{display:flex;align-items:center;gap:.6rem;margin-bottom:.3rem;color:#fff}
  .brand svg{color:#25d366;flex-shrink:0}
  h1{font-size:clamp(1.1rem,4vw,1.4rem);font-weight:700}
  p.sub{color:#666;font-size:.85rem;margin-bottom:1.5rem}
  label{display:block;font-size:.8rem;color:#888;margin-bottom:.4rem}
  .input-wrap{position:relative;display:flex;align-items:center}
  .input-wrap svg{position:absolute;left:.85rem;color:#555;pointer-events:none;flex-shrink:0}
  input{width:100%;padding:.7rem 1rem .7rem 2.4rem;background:#1a1a1a;border:1px solid #333;border-radius:8px;color:#fff;font-size:clamp(.85rem,3.5vw,.95rem);outline:none;transition:border .2s}
  input:focus{border-color:#25d366}
  .row{display:flex;gap:.75rem;margin-top:.75rem}
  button{flex:1;display:flex;align-items:center;justify-content:center;gap:.45rem;padding:.75rem .5rem;border:none;border-radius:8px;font-size:clamp(.8rem,3.5vw,.9rem);font-weight:600;cursor:pointer;transition:opacity .2s;white-space:nowrap}
  button:hover{opacity:.85}
  button:active{opacity:.7}
  .btn-qr{background:#25d366;color:#000}
  .btn-pair{background:#1a73e8;color:#fff}
  #status{margin-top:1.25rem;padding:1rem;border-radius:10px;background:#1a1a1a;border:1px solid #222;display:none;text-align:center}
  #status.show{display:block}
  #status img{max-width:min(240px,80vw);margin:.75rem auto;display:block;border-radius:8px}
  .code{font-size:clamp(1.4rem,6vw,2rem);font-weight:700;letter-spacing:.3rem;color:#25d366;margin:.5rem 0;word-break:break-all}
  .tag{display:inline-flex;align-items:center;gap:.35rem;padding:.25rem .65rem;border-radius:20px;font-size:.75rem;font-weight:600}
  .tag.open{background:#1a3a2a;color:#25d366}
  .tag.pending{background:#2a2a1a;color:#f0c040}
  .tag.failed{background:#3a1a1a;color:#f04040}
  .sessions{margin-top:1.5rem}
  .sessions h2{font-size:.78rem;color:#555;margin-bottom:.75rem;text-transform:uppercase;letter-spacing:.08rem}
  .session-item{display:flex;align-items:center;justify-content:space-between;gap:.5rem;padding:.6rem .75rem;background:#1a1a1a;border-radius:8px;margin-bottom:.5rem;font-size:.85rem}
  .session-phone{display:flex;align-items:center;gap:.4rem;color:#ccc;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  .msg{display:flex;align-items:center;gap:.4rem;font-size:.85rem;color:#888;margin-top:.5rem;min-height:1.3rem}
  .msg.err{color:#f04040}
  .msg.ok{color:#25d366}
  @media(max-width:360px){.row{flex-direction:column}button{width:100%}}
</style>
</head>
<body>
<div class="card">
  <div class="brand">${SVG.bot}<h1>WhatsApp Bot</h1></div>
  <p class="sub">Connect your WhatsApp number to get your own bot instance.</p>

  <label for="phone">WhatsApp number (with country code, no +)</label>
  <div class="input-wrap">${SVG.phone}<input id="phone" type="tel" placeholder="e.g. 2349012345678" autocomplete="off" inputmode="numeric"/></div>

  <div class="row">
    <button class="btn-qr" onclick="connect('qr')">${SVG.qr} Scan QR</button>
    <button class="btn-pair" onclick="connect('pair')">${SVG.pair} Pairing Code</button>
  </div>
  <div id="msg" class="msg"></div>

  <div id="status"></div>

  <div class="sessions" id="sessions-wrap" style="display:none">
    <h2>Active Sessions</h2>
    <div id="sessions-list"></div>
  </div>
</div>

<script>
var IC = {
  check: '${esc(SVG.check)}',
  warn:  '${esc(SVG.warn)}',
  spin:  '${esc(SVG.spin)}',
  phone: '${esc(SVG.phone)}',
};
var pollTimer = null;

function showMsg(text, type, icon) {
  var el = document.getElementById('msg');
  el.innerHTML = (icon ? icon + ' ' : '') + text;
  el.className = 'msg ' + (type || '');
}

async function connect(method) {
  var phone = document.getElementById('phone').value.trim().replace(/\\D/g, '');
  if (!phone || phone.length < 7) return showMsg('Enter a valid phone number.', 'err', IC.warn);
  showMsg('Connecting...', '', IC.spin);
  var res = await fetch('/api/signup', {
    method: 'POST',
    headers: {'content-type': 'application/json'},
    body: JSON.stringify({ phone: phone, method: method })
  });
  var data = await res.json();
  if (!res.ok) return showMsg(data.error || 'Failed', 'err', IC.warn);
  showMsg('', '');
  startPolling(phone, method);
}

function startPolling(phone, method) {
  clearInterval(pollTimer);
  pollTimer = setInterval(function() { poll(phone, method); }, 2500);
  poll(phone, method);
}

async function poll(phone, method) {
  var res = await fetch('/api/status/' + phone);
  var data = await res.json();
  var box = document.getElementById('status');
  box.className = 'show';

  if (data.status === 'open') {
    clearInterval(pollTimer);
    box.innerHTML = '<div class="tag open">' + IC.check + ' Connected</div><p style="margin-top:.5rem;color:#888;font-size:.85rem">Your bot is live! Send <b>,menu</b> to your number.</p>';
    loadSessions();
    return;
  }

  if (method === 'qr' && data.qr) {
    box.innerHTML = '<p style="color:#888;font-size:.85rem;margin-bottom:.5rem">Scan with WhatsApp &rsaquo; Linked Devices</p><img id="qrimg" src="" alt="QR Code"/><p style="color:#555;font-size:.75rem">Auto-refreshes every 2.5s</p>';
    document.getElementById('qrimg').src = data.qr;
    return;
  }

  if (method === 'pair' && data.pairingCode) {
    box.innerHTML = '<p style="color:#888;font-size:.85rem">Enter this code on WhatsApp &rsaquo; Linked Devices &rsaquo; Link with phone number</p><div class="code">' + data.pairingCode + '</div>';
    return;
  }

  if (data.status === 'failed') {
    clearInterval(pollTimer);
    box.innerHTML = '<div class="tag failed">' + IC.warn + ' Failed &mdash; try again</div>';
    return;
  }

  box.innerHTML = '<div class="tag pending">' + IC.spin + ' ' + (data.status || 'Connecting') + '...</div>';
}

async function loadSessions() {
  var res = await fetch('/api/sessions');
  var data = await res.json();
  if (!data.length) return;
  var wrap = document.getElementById('sessions-wrap');
  var list = document.getElementById('sessions-list');
  wrap.style.display = 'block';
  list.innerHTML = data.map(function(s) {
    return '<div class="session-item"><span class="session-phone">' + IC.phone + ' +' + s.phone + '</span><span class="tag ' + s.status + '">' + s.status + '</span></div>';
  }).join('');
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

    if (req.method === 'GET' && path === '/healthz') return send(200, { status: 'ok' });
    if (req.method === 'GET' && path === '/readyz') {
      const s = await getStatus();
      return send(s.mongo ? 200 : 503, s);
    }

    if (req.method === 'GET' && (path === '/fd' || path === '/fd/')) {
      return send(200, HTML, 'text/html');
    }

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

    if (req.method === 'GET' && path === '/api/sessions') {
      return send(200, sessionManager.listSessions());
    }

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
