'use strict';

// MCP dogfood validation script.
// Spawns mem mcp as a child process, sends JSON-RPC calls for all 6 tools,
// writes results to .evo-lite/generated/mcp-validation.json.

const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

const TOOLS = [
    { name: 'evo_recall', arguments: { query: 'dogfood cycle', k: 3 } },
    { name: 'evo_verify', arguments: {} },
    { name: 'evo_plan_status', arguments: {} },
    { name: 'evo_architecture_status', arguments: {} },
    { name: 'evo_drift_status', arguments: {} },
    { name: 'evo_active_context', arguments: {} },
];

function buildMsg(id, method, params) {
    return JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n';
}

async function validate(root) {
    const memCli = path.join(root, '.evo-lite', 'cli', 'memory.js');
    const child = spawn(process.execPath, [memCli, 'mcp'], {
        cwd: root,
        stdio: ['pipe', 'pipe', 'pipe'],
    });

    const results = {};
    let buf = '';

    const responses = new Promise((resolve, reject) => {
        child.stdout.on('data', chunk => {
            buf += chunk.toString();
            const lines = buf.split('\n');
            buf = lines.pop();
            for (const line of lines) {
                if (!line.trim()) continue;
                try {
                    const msg = JSON.parse(line);
                    if (msg.id != null) results[msg.id] = msg;
                } catch (_) {}
            }
        });
        child.on('exit', resolve);
        child.on('error', reject);
    });

    // Send initialize, wait for handshake before tool calls
    child.stdin.write(buildMsg(0, 'initialize', {
        protocolVersion: '2024-11-05',
        capabilities: {},
        clientInfo: { name: 'mcp-validate', version: '1' },
    }));

    await new Promise(r => setTimeout(r, 600));

    // Send all tool calls
    for (let i = 0; i < TOOLS.length; i++) {
        child.stdin.write(buildMsg(i + 1, 'tools/call', {
            name: TOOLS[i].name,
            arguments: TOOLS[i].arguments,
        }));
    }

    // Give server time to process then close
    await new Promise(r => setTimeout(r, 2000));
    child.stdin.end();
    await responses;

    const report = {
        validatedAt: new Date().toISOString(),
        serverVersion: results[0]?.result?.serverInfo?.version ?? 'unknown',
        tools: TOOLS.map((t, i) => {
            const resp = results[i + 1];
            const ok = resp && resp.result && !resp.result.isError;
            let preview = null;
            if (ok) {
                try {
                    const parsed = JSON.parse(resp.result.content[0].text);
                    preview = summarise(t.name, parsed);
                } catch (_) {}
            }
            return {
                tool: t.name,
                status: ok ? 'ok' : 'error',
                error: resp?.result?.isError ? resp.result.content[0]?.text : undefined,
                preview,
            };
        }),
    };

    const outDir = path.join(root, '.evo-lite', 'generated');
    fs.mkdirSync(outDir, { recursive: true });
    const outPath = path.join(outDir, 'mcp-validation.json');
    fs.writeFileSync(outPath, JSON.stringify(report, null, 2), 'utf8');
    return { report, outPath };
}

function summarise(tool, data) {
    switch (tool) {
        case 'evo_recall': return `${(data.results || []).length} hits for query "${data.query}"`;
        case 'evo_verify': return `engine: ${data.active_engine}, namespaces: ${Object.keys(data.namespaces || {}).length}`;
        case 'evo_plan_status': return `${data.specCount} specs, ${data.planCount} plans, ${data.taskCount} tasks (${data.tasksByStatus?.implemented ?? 0} done)`;
        case 'evo_architecture_status': return `${data.moduleCount} modules, ${data.fileCount} files`;
        case 'evo_drift_status': return `${data.summary?.total ?? 0} findings (${data.summary?.errors ?? 0} errors, ${data.summary?.warnings ?? 0} warnings)`;
        case 'evo_active_context': return `focus: "${(data.focus || '').slice(0, 60)}"`;
        default: return null;
    }
}

if (require.main === module) {
    const root = process.argv[2] || process.cwd();
    validate(root).then(({ report, outPath }) => {
        const ok = report.tools.filter(t => t.status === 'ok').length;
        const total = report.tools.length;
        console.log(`MCP validation: ${ok}/${total} tools OK  (server ${report.serverVersion})`);
        for (const t of report.tools) {
            const icon = t.status === 'ok' ? '✅' : '❌';
            console.log(`  ${icon} ${t.tool}: ${t.preview ?? t.error ?? '-'}`);
        }
        console.log(`Written: ${outPath}`);
        process.exit(ok === total ? 0 : 1);
    }).catch(err => {
        console.error('Validation failed:', err.message);
        process.exit(1);
    });
}

module.exports = { validate };
