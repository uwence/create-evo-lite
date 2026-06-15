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
const { getActiveEngineInfo } = require('./models');
const { getActiveContextPath, getIndexMemoryDir, getRawMemoryDir, getWorkspaceRoot } = require('./runtime');

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
    const indexDir = getIndexMemoryDir();
    if (!fs.existsSync(rawDir)) return [];
    const indexSet = fs.existsSync(indexDir)
        ? new Set(fs.readdirSync(indexDir).filter(f => f.endsWith('.md')))
        : new Set();
    return fs.readdirSync(rawDir).filter(f => f.endsWith('.md')).map(file => ({
        file,
        indexed: indexSet.has(file),
    }));
}

function buildVerifyJson() {
    const db = getDb();
    const { model, dims } = getActiveEngineInfo();
    const namespaces = getNamespaceCounts(db);
    const safetyState = memoryService.getSafetyState ? memoryService.getSafetyState() : { blockCount: 0, redactionCount: 0, lastBlock: null };
    return {
        active_engine: model,
        active_version: dims,
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
    <button data-tab="planning">Planning</button>
    <button data-tab="archive">Archive</button>
    <button data-tab="indexes">Index spaces</button>
    <button data-tab="architecture">Architecture</button>
    <button data-tab="drift">Drift</button>
    <button data-tab="verify">Verify</button>
  </nav>
</header>
<main>
  <section id="tab-timeline"></section>
  <section id="tab-planning" hidden></section>
  <section id="tab-archive" hidden></section>
  <section id="tab-indexes" hidden></section>
  <section id="tab-architecture" hidden></section>
  <section id="tab-drift" hidden></section>
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
    } else if (name === 'planning') {
      const data = await api('/api/planning');
      if (data.missing) {
        target.innerHTML = '<h2>Planning</h2><p class="pending">No plan-ir.json found.</p><pre>' + escapeHtml(data.hint) + '</pre>';
      } else {
        let html = '<h2>Planning <small style="opacity:0.5;font-size:0.8em">' + escapeHtml(data.version) + '</small></h2>';
        for (const spec of (data.specs || [])) {
          html += '<h3>Spec: ' + escapeHtml(spec.id) + ' <span class="' + (spec.status === 'planned' ? 'pending' : 'ok') + '">[' + escapeHtml(spec.status) + ']</span></h3>';
          html += '<p style="opacity:0.7">' + escapeHtml(spec.sourcePath) + '</p>';
          if (spec.linkedPlans && spec.linkedPlans.length) {
            html += '<p>Linked plans: ' + spec.linkedPlans.map(p => escapeHtml(p)).join(', ') + '</p>';
          }
          if (spec.acceptanceCriteria && spec.acceptanceCriteria.length) {
            html += '<details><summary>Acceptance criteria (' + spec.acceptanceCriteria.length + ')</summary><ul>' +
              spec.acceptanceCriteria.map(c => '<li>' + escapeHtml(c) + '</li>').join('') + '</ul></details>';
          }
        }
        for (const plan of (data.plans || [])) {
          const planTasks = (data.tasks || []).filter(t => t.linkedPlan === plan.id);
          const done = planTasks.filter(t => t.status === 'implemented').length;
          html += '<h3>Plan: ' + escapeHtml(plan.id) + ' <span class="' + (done === planTasks.length ? 'ok' : 'pending') + '">' + done + '/' + planTasks.length + ' done</span></h3>';
          html += '<p style="opacity:0.7">' + escapeHtml(plan.sourcePath) + '</p>';
          if (planTasks.length) {
            html += '<table><tr><th>Task</th><th>Status</th><th>Phase</th><th>Linked files</th></tr>';
            for (const t of planTasks) {
              const cls = t.status === 'implemented' ? 'ok' : 'pending';
              html += '<tr><td>' + escapeHtml(t.id) + '</td><td class="' + cls + '">' + escapeHtml(t.status) + '</td>';
              html += '<td>' + escapeHtml(t.phase || '') + '</td>';
              html += '<td>' + (t.linkedFiles || []).map(f => escapeHtml(f)).join('<br>') + '</td></tr>';
            }
            html += '</table>';
          }
        }
        if (data.warnings && data.warnings.length) {
          html += '<details><summary>Warnings (' + data.warnings.length + ')</summary><ul>' +
            data.warnings.map(w => '<li class="' + (w.level === 'error' ? 'err' : 'pending') + '">[' + escapeHtml(w.level || 'warn') + '] ' + escapeHtml(w.message) + '</li>').join('') + '</ul></details>';
        }
        target.innerHTML = html;
      }
    } else if (name === 'archive') {
      const data = await api('/api/archive');
      target.innerHTML = '<h2>Archive (' + data.files.length + ')</h2><table><tr><th>File</th><th>Indexed</th></tr>' +
        data.files.map(f => '<tr><td>' + escapeHtml(f.file) + '</td><td class="' + (f.indexed ? 'ok' : 'pending') +
        '">' + (f.indexed ? 'yes' : 'pending') + '</td></tr>').join('') + '</table>';
    } else if (name === 'indexes') {
      const data = await api('/api/verify');
      const rows = Object.entries(data.namespaces).map(([ns, info]) =>
        '<tr><td>' + escapeHtml(ns) + '</td><td>' + (info.present ? escapeHtml(String(info.model || 'unset')) : '-') +
        '</td><td>' + (info.present ? info.dims || '?' : '-') + '</td><td>' + info.chunks + '</td></tr>'
      ).join('');
      target.innerHTML = '<h2>Index spaces</h2><table><tr><th>Namespace</th><th>Engine</th><th>Dims</th><th>Chunks</th></tr>' + rows + '</table>';
    } else if (name === 'architecture') {
      const data = await api('/api/architecture');
      if (data.missing) {
        target.innerHTML = '<h2>Architecture</h2><p class="pending">No architecture-ir.json found.</p><pre>' + escapeHtml(data.hint) + '</pre>';
      } else {
        let html = '<h2>Architecture <small style="opacity:0.5;font-size:0.8em">' + escapeHtml(data.version) + ' · ' + escapeHtml(data.provider) + '</small></h2>';
        html += '<table><tr><th>Module</th><th>Role</th><th>Files</th><th>Description</th></tr>';
        for (const mod of (data.modules || [])) {
          html += '<tr><td>' + escapeHtml(mod.id) + '</td><td>' + escapeHtml(mod.role) + '</td><td>' + (mod.fileCount || 0) + '</td><td style="opacity:0.7">' + escapeHtml(mod.description || '') + '</td></tr>';
        }
        html += '</table>';
        const unclassified = (data.files || []).filter(f => !f.module).length;
        if (unclassified > 0) html += '<p class="pending">' + unclassified + ' unclassified files</p>';
        target.innerHTML = html;
      }
    } else if (name === 'drift') {
      const data = await api('/api/drift');
      if (data.missing) {
        target.innerHTML = '<h2>Drift</h2><p class="pending">No drift-report.json found.</p><pre>' + escapeHtml(data.hint) + '</pre>';
      } else {
        const s = data.summary || {};
        let html = '<h2>Drift <small style="opacity:0.5;font-size:0.8em">' + escapeHtml(data.version) + '</small></h2>';
        html += '<p>' + (s.total || 0) + ' findings · <span class="err">' + (s.errors || 0) + ' errors</span> · <span class="pending">' + (s.warnings || 0) + ' warnings</span> · ' + (s.info || 0) + ' info</p>';
        if ((data.findings || []).length > 0) {
          html += '<table><tr><th>Rule</th><th>Scope</th><th>Level</th><th>Message</th><th>Action</th></tr>';
          for (const f of data.findings) {
            const cls = f.level === 'error' ? 'err' : f.level === 'warning' ? 'pending' : '';
            html += '<tr><td>' + escapeHtml(f.rule) + '</td><td>' + escapeHtml(f.scope || '') + '</td>';
            html += '<td class="' + cls + '">' + escapeHtml(f.level) + '</td>';
            html += '<td>' + escapeHtml(f.message) + '</td>';
            html += '<td style="opacity:0.7">' + escapeHtml(f.suggestedAction || '') + '</td></tr>';
          }
          html += '</table>';
        } else {
          html += '<p class="ok">No drift findings.</p>';
        }
        target.innerHTML = html;
      }
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
        if (url === '/api/planning') {
            const irPath = path.join(getWorkspaceRoot(), '.evo-lite', 'generated', 'planning', 'plan-ir.json');
            if (!fs.existsSync(irPath)) {
                return send(200, { missing: true, hint: 'Run: mem plan scan' });
            }
            return send(200, JSON.parse(fs.readFileSync(irPath, 'utf8')));
        }
        if (url === '/api/architecture') {
            const irPath = path.join(getWorkspaceRoot(), '.evo-lite', 'generated', 'architecture', 'architecture-ir.json');
            if (!fs.existsSync(irPath)) {
                return send(200, { missing: true, hint: 'Run: mem architecture scan' });
            }
            return send(200, JSON.parse(fs.readFileSync(irPath, 'utf8')));
        }
        if (url === '/api/drift') {
            const reportPath = path.join(getWorkspaceRoot(), '.evo-lite', 'generated', 'architecture', 'drift-report.json');
            if (!fs.existsSync(reportPath)) {
                return send(200, { missing: true, hint: 'Run: mem architecture diff && mem plan gaps' });
            }
            return send(200, JSON.parse(fs.readFileSync(reportPath, 'utf8')));
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
