// Evo-Lite local inspector (P4).
//
// Zero-dependency http.createServer + bundled static HTML. Loopback only.
// Reuses memory.service public API (verify / summarizeArchiveHealth / recall)
// rather than introducing any read-only second source of truth.

const http = require('http');
const fs = require('fs');
const path = require('path');
const memoryService = require('./memory.service');
const { closeDb, getDb, getNamespaceCounts, getNamespaces, tableExists } = require('./db');
const { getActiveModelInfo } = require('./models');
const { getActiveContextPath, getRawMemoryDir, getVectMemoryDir } = require('./runtime');

function readActiveContext() {
    const p = getActiveContextPath();
    if (!fs.existsSync(p)) return null;
    return fs.readFileSync(p, 'utf8');
}

function extractTrajectory(markdown) {
    if (!markdown) return [];
    const match = markdown.match(/<!-- BEGIN_TRAJECTORY -->([\s\S]*?)<!-- END_TRAJECTORY -->/);
    if (!match) return [];
    return match[1]
        .split('\n')
        .map(line => line.trim())
        .filter(line => line.startsWith('-'));
}

function listArchiveFiles() {
    const rawDir = getRawMemoryDir();
    const vectDir = getVectMemoryDir();
    if (!fs.existsSync(rawDir)) return [];
    const vectSet = fs.existsSync(vectDir)
        ? new Set(fs.readdirSync(vectDir).filter(f => f.endsWith('.md')))
        : new Set();
    return fs.readdirSync(rawDir).filter(f => f.endsWith('.md')).map(file => ({
        file,
        vectorized: vectSet.has(file),
    }));
}

function buildVerifyJson() {
    const db = getDb();
    const { model, dims } = getActiveModelInfo();
    const namespaces = getNamespaceCounts(db);
    const safetyState = memoryService.getSafetyState ? memoryService.getSafetyState() : { blockCount: 0, redactionCount: 0, lastBlock: null };
    return {
        active_model: model,
        active_dims: dims,
        namespaces,
        archive_health: memoryService.summarizeArchiveHealth(),
        safety: safetyState,
    };
}

function safeNumber(input, fallback) {
    const n = Number(input);
    if (!Number.isFinite(n) || n <= 0) return fallback;
    return n;
}

function renderHtml() {
    return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Evo-Lite Inspector</title>
<style>
  body { font-family: -apple-system, BlinkMacSystemFont, sans-serif; margin: 0; background:#0f1115; color:#e4e6eb; }
  header { padding: 12px 20px; background:#181b22; border-bottom: 1px solid #2a2f3a; }
  nav button { background:#222630; color:#e4e6eb; border:1px solid #2a2f3a; padding:6px 12px; margin-right:6px; cursor:pointer; }
  nav button.active { background:#3b82f6; border-color:#3b82f6; }
  main { padding: 20px; }
  pre { background:#1a1d24; padding:10px; border-radius:6px; overflow:auto; white-space:pre-wrap; }
  .row { padding: 4px 0; border-bottom:1px solid #222; }
  .pending { color:#fbbf24; }
  .ok { color:#34d399; }
  .err { color:#f87171; }
  table { width:100%; border-collapse: collapse; }
  td, th { text-align:left; padding:6px 10px; border-bottom:1px solid #222; }
</style>
</head>
<body>
<header>
  <strong>Evo-Lite Inspector</strong> · <span style="opacity:0.6">read-only · 127.0.0.1 only</span>
  <nav style="margin-top:8px">
    <button data-tab="timeline" class="active">Active context</button>
    <button data-tab="archive">Archive</button>
    <button data-tab="vectors">Vector spaces</button>
    <button data-tab="verify">Verify</button>
  </nav>
</header>
<main>
  <section id="tab-timeline"></section>
  <section id="tab-archive" hidden></section>
  <section id="tab-vectors" hidden></section>
  <section id="tab-verify" hidden></section>
</main>
<script>
async function api(path) {
  const r = await fetch(path);
  if (!r.ok) throw new Error('API ' + path + ' returned ' + r.status);
  return r.json();
}
function showTab(name) {
  document.querySelectorAll('nav button').forEach(b => b.classList.toggle('active', b.dataset.tab === name));
  document.querySelectorAll('main section').forEach(s => s.hidden = (s.id !== 'tab-' + name));
}
document.querySelectorAll('nav button').forEach(btn => {
  btn.addEventListener('click', () => { showTab(btn.dataset.tab); load(btn.dataset.tab); });
});
async function load(name) {
  const target = document.getElementById('tab-' + name);
  target.innerHTML = 'Loading...';
  try {
    if (name === 'timeline') {
      const data = await api('/api/timeline');
      target.innerHTML = '<h2>Trajectory</h2>' + (data.entries.length === 0
        ? '<p>No trajectory entries.</p>'
        : '<ol>' + data.entries.map(e => '<li>' + escapeHtml(e) + '</li>').join('') + '</ol>');
    } else if (name === 'archive') {
      const data = await api('/api/archive');
      target.innerHTML = '<h2>Archive (' + data.files.length + ')</h2><table><tr><th>File</th><th>Vectorized</th></tr>' +
        data.files.map(f => '<tr><td>' + escapeHtml(f.file) + '</td><td class="' + (f.vectorized ? 'ok' : 'pending') +
        '">' + (f.vectorized ? 'yes' : 'pending') + '</td></tr>').join('') + '</table>';
    } else if (name === 'vectors') {
      const data = await api('/api/verify');
      const rows = Object.entries(data.namespaces).map(([ns, info]) =>
        '<tr><td>' + escapeHtml(ns) + '</td><td>' + (info.present ? escapeHtml(String(info.model || 'unset')) : '-') +
        '</td><td>' + (info.present ? info.dims || '?' : '-') + '</td><td>' + info.chunks + '</td></tr>'
      ).join('');
      target.innerHTML = '<h2>Vector spaces</h2><table><tr><th>Namespace</th><th>Model</th><th>Dims</th><th>Chunks</th></tr>' + rows + '</table>';
    } else if (name === 'verify') {
      const data = await api('/api/verify');
      target.innerHTML = '<h2>Verify snapshot</h2><pre>' + escapeHtml(JSON.stringify(data, null, 2)) + '</pre>';
    }
  } catch (e) {
    target.innerHTML = '<p class="err">Error loading ' + name + ': ' + escapeHtml(e.message) + '</p>';
  }
}
function escapeHtml(s) { return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c]); }
load('timeline');
</script>
</body>
</html>`;
}

function handleApi(req, res) {
    const url = req.url || '/';
    const send = (status, body) => {
        res.writeHead(status, {
            'content-type': 'application/json; charset=utf-8',
            'cache-control': 'no-store',
        });
        res.end(JSON.stringify(body));
    };

    try {
        if (url === '/api/timeline') {
            const md = readActiveContext();
            return send(200, { entries: extractTrajectory(md) });
        }
        if (url === '/api/archive') {
            return send(200, { files: listArchiveFiles() });
        }
        if (url === '/api/verify') {
            return send(200, buildVerifyJson());
        }
    } catch (error) {
        return send(500, { error: error.message });
    }

    return send(404, { error: 'unknown api', path: url });
}

function startServer(options = {}) {
    const host = '127.0.0.1';
    const port = safeNumber(options.port, 0);
    const server = http.createServer((req, res) => {
        // Security: only allow loopback even though we bind 127.0.0.1.
        const remote = req.socket && req.socket.remoteAddress;
        if (remote && remote !== '127.0.0.1' && remote !== '::1' && remote !== '::ffff:127.0.0.1') {
            res.writeHead(403, { 'content-type': 'text/plain' });
            res.end('forbidden');
            return;
        }

        const url = (req.url || '').split('?')[0];
        if (url === '/' || url === '/index.html') {
            res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
            res.end(renderHtml());
            return;
        }
        if (url.startsWith('/api/')) {
            return handleApi(req, res);
        }
        res.writeHead(404, { 'content-type': 'text/plain' });
        res.end('not found');
    });

    return new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(port, host, () => {
            const address = server.address();
            resolve({
                server,
                host,
                port: address.port,
                url: `http://${host}:${address.port}/`,
                close: () => new Promise(r => server.close(() => r())),
            });
        });
    });
}

async function runInspectCommand(options = {}) {
    // Touch the DB once so callers that haven't yet initialized it get a clear
    // error instead of an empty inspector.
    try { getDb(); } catch (_) {}

    const handle = await startServer(options);
    console.log(`🔍 Evo-Lite Inspector listening on ${handle.url}`);
    console.log('ℹ️  Loopback only. Press Ctrl+C to stop.');

    const shutdown = async () => {
        try { await handle.close(); } catch (_) {}
        try { closeDb(); } catch (_) {}
        process.exit(0);
    };
    process.once('SIGINT', shutdown);
    process.once('SIGTERM', shutdown);
    return handle;
}

module.exports = {
    buildVerifyJson,
    extractTrajectory,
    listArchiveFiles,
    runInspectCommand,
    startServer,
};
