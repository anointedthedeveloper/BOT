import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import nodePath from 'node:path';
import qrcode from 'qrcode';

// import.meta.url = file:///…/src/services/dashboard.js
// ../../  = project root  (services -> src -> root)
const ROOT = nodePath.resolve(nodePath.dirname(fileURLToPath(import.meta.url)), '../..');
// Render deploys to /app but process.cwd() is always the actual working dir
const IMAGE_PATH = (() => {
  const candidates = [
    nodePath.join(ROOT, 'image.png'),
    nodePath.join(process.cwd(), 'image.png'),
    '/app/image.png',
  ];
  return candidates; // try all at serve time
})();
console.log('[dashboard] ROOT:', ROOT, '| cwd:', process.cwd());

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
  .code{font-size:clamp(1.4rem,6vw,2rem);font-weight:700;letter-spacing:.3rem;color:#25d366;margin:.5rem 0;word-break:break-all;cursor:pointer;user-select:all;padding:.4rem .6rem;border-radius:6px;transition:background .15s}
  .code:hover{background:#1a3a2a}
  .copy-hint{font-size:.72rem;color:#555;margin-top:.25rem}
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
  .tutorial{margin-top:1.25rem;border:1px solid #222;border-radius:10px;overflow:hidden}
  .tutorial-toggle{width:100%;background:#1a1a1a;border:none;color:#888;font-size:.8rem;padding:.65rem 1rem;text-align:left;cursor:pointer;display:flex;align-items:center;justify-content:space-between;gap:.5rem}
  .tutorial-toggle:hover{color:#ccc}
  .tutorial-toggle .arrow{transition:transform .2s;font-style:normal}
  .tutorial-toggle.open .arrow{transform:rotate(180deg)}
  .tutorial-body{display:none;padding:.9rem 1rem;background:#111;font-size:.82rem;color:#aaa;line-height:1.6}
  .tutorial-body.show{display:block}
  .tutorial-body h3{font-size:.78rem;color:#25d366;text-transform:uppercase;letter-spacing:.06rem;margin:0 0 .5rem}
  .tutorial-body ol{padding-left:1.2rem;margin:0 0 1rem}
  .tutorial-body ol:last-child{margin-bottom:0}
  .tutorial-body li{margin-bottom:.35rem}
  .tutorial-body b{color:#e0e0e0}
  .tutorial-body .note{margin-top:.75rem;padding:.5rem .75rem;background:#1a1a1a;border-left:3px solid #333;border-radius:4px;color:#666;font-size:.78rem}
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

  <div class="tutorial">
    <button class="tutorial-toggle" onclick="toggleTutorial(this)">
      <span>How to link your WhatsApp</span>
      <i class="arrow">&#8964;</i>
    </button>
    <div class="tutorial-body">
      <h3>Option A &mdash; Pairing Code (recommended)</h3>
      <ol>
        <li>Enter your WhatsApp number above (with country code, no +).<br><b>Example:</b> 2349012345678</li>
        <li>Tap <b>Pairing Code</b>.</li>
        <li>Open WhatsApp on your phone.</li>
        <li>Go to <b>Settings &rsaquo; Linked Devices &rsaquo; Link a Device</b>.</li>
        <li>Tap <b>Link with phone number</b> instead of scanning.</li>
        <li>Enter the 8-character code shown on this page.</li>
        <li>Wait a few seconds &mdash; the status will change to <b>Connected</b>.</li>
      </ol>
      <h3>Option B &mdash; QR Code</h3>
      <ol>
        <li>Enter your number and tap <b>Scan QR</b>.</li>
        <li>Open WhatsApp &rsaquo; <b>Settings &rsaquo; Linked Devices &rsaquo; Link a Device</b>.</li>
        <li>Point your camera at the QR code shown on this page.</li>
        <li>The QR refreshes every few seconds &mdash; scan it quickly.</li>
      </ol>
      <div class="note">
        &#9432;&nbsp; You have <b>10 minutes</b> to complete linking before the session expires.<br>
        &#9432;&nbsp; Your WhatsApp account stays active on your phone &mdash; this links a secondary device.<br>
        &#9432;&nbsp; Once connected, send <b>,menu</b> to your own number to see all commands.
      </div>
    </div>
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
  var res, data;
  try {
    res = await fetch('/api/status/' + phone);
    data = await res.json();
  } catch (e) {
    return; // network blip — keep polling
  }
  var box = document.getElementById('status');
  box.className = 'show';

  if (res.status === 404) {
    clearInterval(pollTimer);
    box.innerHTML = '<div class="tag failed">' + IC.warn + ' Session expired &mdash; try again</div>';
    return;
  }

  if (data.status === 'open') {
    clearInterval(pollTimer);
    box.innerHTML = '<div class="tag open">' + IC.check + ' Connected</div><p style="margin-top:.5rem;color:#888;font-size:.85rem">Your bot is live! Send <b>,menu</b> to your number to get started.</p>';
    loadSessions();
    return;
  }

  if (method === 'pair' && data.pairingCode) {
    box.innerHTML = '<p style="color:#888;font-size:.85rem">Enter this code on WhatsApp &rsaquo; Linked Devices &rsaquo; Link with phone number</p><div class="code" onclick="copyCode(this)" title="Click to copy">' + data.pairingCode + '</div><p class="copy-hint">&#128203; Click code to copy</p>';
    return;
  }

  if (method === 'qr' && data.qr) {
    box.innerHTML = '<p style="color:#888;font-size:.85rem;margin-bottom:.5rem">Scan with WhatsApp &rsaquo; Linked Devices</p><img id="qrimg" src="" alt="QR Code"/><p style="color:#555;font-size:.75rem">Auto-refreshes every 2.5s</p>';
    document.getElementById('qrimg').src = data.qr;
    return;
  }

  if (data.status === 'failed') {
    clearInterval(pollTimer);
    box.innerHTML = '<div class="tag failed">' + IC.warn + ' Failed &mdash; try again</div>';
    return;
  }

  box.innerHTML = '<div class="tag pending">' + IC.spin + ' ' + (data.status || 'connecting') + '...</div>';
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

function toggleTutorial(btn) {
  var body = btn.nextElementSibling;
  var isOpen = body.classList.contains('show');
  body.classList.toggle('show', !isOpen);
  btn.classList.toggle('open', !isOpen);
}

function copyCode(el) {
  var code = el.innerText.replace(/[^A-Z0-9]/g, '');
  if (!navigator.clipboard) {
    // fallback for older browsers
    var ta = document.createElement('textarea');
    ta.value = code;
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    document.body.removeChild(ta);
  } else {
    navigator.clipboard.writeText(code);
  }
  var hint = el.nextElementSibling;
  if (hint) { hint.innerText = '\u2705 Copied!'; setTimeout(function(){ hint.innerText = '\u{1F4CB} Click code to copy'; }, 2000); }
}
</script>
</body>
</html>`;

export function createDashboard({ sessionManager, tenants, getStatus, logger, db, botName = 'WhatsApp Bot' }) {
  const safeTitle = botName.replace(/[<>"'&]/g, (c) => ({ '<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;','&':'&amp;' }[c]));
  const PAGE = HTML.replace(/WhatsApp Bot/g, safeTitle);
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
      return send(200, PAGE, 'text/html');
    }

    if (req.method === 'GET' && path === '/image.png') {
      for (const filePath of IMAGE_PATH) {
        try {
          const buf = await readFile(filePath);
          res.writeHead(200, { 'content-type': 'image/png', 'cache-control': 'public,max-age=3600' });
          return res.end(buf);
        } catch { /* try next */ }
      }
      logger.warn({ tried: IMAGE_PATH }, 'image.png not found in any candidate path');
      return send(404, { error: 'image not found', tried: IMAGE_PATH });
    }

    if (req.method === 'GET' && path === '/debug-fs') {
      const { readdir } = await import('node:fs/promises');
      const dirs = {};
      for (const d of ['/app', ROOT, nodePath.join(ROOT, '..'), '/opt/render/project/src']) {
        try { dirs[d] = await readdir(d); } catch (e) { dirs[d] = e.message; }
      }
      return send(200, dirs);
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
        // Stop any existing non-open in-memory session
        const existingSession = sessionManager.getSession(digits);
        if (existingSession && existingSession.status !== 'open') {
          await sessionManager.stopSession(digits);
        }

        if (!existing) {
          await tenants.create(digits);
        } else {
          // Always clear stale auth unless the session is currently open in memory
          const liveSession = sessionManager.getSession(digits);
          const isLiveAndOpen = liveSession?.status === 'open';
          if (!isLiveAndOpen) {
            await tenants.setStatus(digits, 'pending');
            try { await db.collection(`wa_auth_${digits}`).deleteMany({}); } catch { /* non-fatal */ }
          } else {
            return send(200, { ok: true, already: true });
          }
        }

        const pairingPhone = method === 'pair' ? digits : null;
        sessionManager.startSession(digits, { pairingPhone }).catch(err =>
          logger.error({ err, phone: digits }, 'session start failed')
        );
        return send(200, { ok: true });
      } catch (err) {
        logger.error({ err }, 'signup error');
        return send(400, { error: 'Bad request' });
      }
    }

    if (req.method === 'GET' && path.startsWith('/api/status/')) {
      const phone = path.split('/').pop().split(':')[0];
      const session = sessionManager.getSession(phone);
      if (!session) return send(404, { error: 'Not found' });
      const pairingCode = session.pairingCode ?? session.client?.currentPairingCode ?? null;
      const out = { status: session.status, pairingCode, qr: null };
      const rawQr = session.client?.currentQr ?? null;
      if (rawQr) {
        try { out.qr = await qrcode.toDataURL(rawQr, { width: 256, margin: 1 }); } catch {}
      }
      return send(200, out);
    }

    if (req.method === 'GET' && path === '/api/sessions') {
      const sessions = sessionManager.listSessions();
      const masked = sessions.map((s) => ({
        ...s,
        phone: s.phone ? s.phone.slice(0, 3) + '****' + s.phone.slice(-2) : s.phone,
      }));
      return send(200, masked);
    }

    if (req.method === 'DELETE' && path.startsWith('/api/sessions/')) {
      const phone = path.split('/').pop().split(':')[0];
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
