'use strict';

const { Server } = require('@modelcontextprotocol/sdk/server/index.js');
const { StdioServerTransport } = require('@modelcontextprotocol/sdk/server/stdio.js');
const { ListToolsRequestSchema, CallToolRequestSchema } = require('@modelcontextprotocol/sdk/types.js');

const { getWorkspaceRoot } = require('./runtime');
const { buildVerifyJson, extractActiveContext } = require('./inspector');
const memoryService = require('./memory.service');
const fs = require('fs');
const path = require('path');

// freshRequire: reload a local module if its source file mtime is newer than
// the version sitting in require.cache. The MCP server is long-lived; without
// this, edits to scan-native.js / scan.js / gaps.js / diff.js take effect only
// after a server restart, producing the staleness the user observed during
// dogfood (mem architecture scan wrote 11 modules to disk, MCP still returned
// the 10 captured at MCP startup).
const _moduleLoadMtimes = new Map();
function freshRequire(relPath) {
    const resolved = require.resolve(relPath);
    let mtimeMs = 0;
    try { mtimeMs = fs.statSync(resolved).mtimeMs; } catch (_) {}
    const last = _moduleLoadMtimes.get(resolved);
    if (last == null || mtimeMs > last) {
        delete require.cache[resolved];
        _moduleLoadMtimes.set(resolved, mtimeMs);
    }
    return require(resolved);
}

// ── Tool definitions ──────────────────────────────────────────────────────────

const TOOLS = [
    {
        name: 'evo_recall',
        description: 'Search Evo-Lite memory archive. Returns top-K recall hits for a query.',
        inputSchema: {
            type: 'object',
            properties: {
                query: { type: 'string', description: 'Search query' },
                k: { type: 'number', description: 'Max results (default 5)', default: 5 },
            },
            required: ['query'],
        },
    },
    {
        name: 'evo_verify',
        description: 'Return Evo-Lite verify snapshot: engine, namespaces, archive health, safety state.',
        inputSchema: { type: 'object', properties: {} },
    },
    {
        name: 'evo_plan_status',
        description: 'Return Planning IR summary: specs, plans, task counts and statuses.',
        inputSchema: { type: 'object', properties: {} },
    },
    {
        name: 'evo_architecture_status',
        description: 'Return Architecture IR summary: modules, file counts, provider.',
        inputSchema: { type: 'object', properties: {} },
    },
    {
        name: 'evo_drift_status',
        description: 'Live-scan and return drift findings (architecture + planning). Never stale.',
        inputSchema: { type: 'object', properties: {} },
    },
    {
        name: 'evo_active_context',
        description: 'Return parsed active_context.md: meta, current focus, backlog, recent trajectory.',
        inputSchema: { type: 'object', properties: {} },
    },
    {
        name: 'evo_code_explore',
        description: 'Explore code and its Evo-Lite governance context using the best available code-perception provider.',
        inputSchema: {
            type: 'object',
            properties: {
                query: { type: 'string' },
                focusId: { type: 'string' },
                includeSource: { type: 'boolean', default: true },
                includeImpact: { type: 'boolean', default: true },
                maxResults: { type: 'number', default: 10 },
            },
            required: ['query'],
        },
    },
];

// ── Tool handlers ─────────────────────────────────────────────────────────────

async function handleRecall(args) {
    const query = args.query || '';
    const k = Number(args.k) || 5;
    const results = await memoryService.recall(query, k);
    return { query, k, results: Array.isArray(results) ? results : [] };
}

function handleVerify() {
    return buildVerifyJson();
}

function handlePlanStatus() {
    const { scanPlanning } = freshRequire('./planning/scan');
    const ir = scanPlanning(getWorkspaceRoot());
    return {
        version: ir.version,
        specCount: ir.specs.length,
        planCount: ir.plans.length,
        taskCount: ir.tasks.length,
        tasksByStatus: {
            implemented: ir.tasks.filter(t => t.status === 'implemented').length,
            todo: ir.tasks.filter(t => t.status === 'todo').length,
        },
        plans: ir.plans.map(p => {
            const planTasks = ir.tasks.filter(t => t.linkedPlan === p.id);
            const done = planTasks.filter(t => t.status === 'implemented').length;
            return { id: p.id, title: p.title, status: p.status, tasks: planTasks.length, done };
        }),
        warnings: ir.warnings,
    };
}

function handleArchitectureStatus() {
    const { scanArchitecture } = freshRequire('./architecture/scan-native');
    const ir = scanArchitecture(getWorkspaceRoot());
    return {
        version: ir.version,
        provider: ir.provider,
        moduleCount: (ir.modules || []).length,
        fileCount: (ir.files || []).length,
        unclassified: (ir.files || []).filter(f => !f.module).length,
        modules: (ir.modules || []).map(m => ({
            id: m.id, name: m.name, role: m.role, fileCount: m.fileCount,
        })),
    };
}

function handleDriftStatus() {
    const root = getWorkspaceRoot();
    const { scanPlanning } = freshRequire('./planning/scan');
    const { scanArchitecture } = freshRequire('./architecture/scan-native');
    const { runPlanningDrift } = freshRequire('./planning/gaps');
    const { runArchitectureDrift } = freshRequire('./architecture/diff');
    const planIR = scanPlanning(root);
    const archIR = scanArchitecture(root);
    const findings = [
        ...runArchitectureDrift(root, archIR),
        ...runPlanningDrift(root, planIR),
    ];
    return {
        version: 'evo-drift-report@1',
        findings,
        summary: {
            total: findings.length,
            errors: findings.filter(f => f.level === 'error').length,
            warnings: findings.filter(f => f.level === 'warning').length,
            info: findings.filter(f => f.level === 'info').length,
        },
    };
}

function handleActiveContext() {
    const p = path.join(getWorkspaceRoot(), '.evo-lite', 'active_context.md');
    if (!fs.existsSync(p)) return { error: 'active_context.md not found' };
    const md = fs.readFileSync(p, 'utf8');
    return extractActiveContext(md);
}

async function handleCodeExplore(args, deps) {
    const service = (deps && deps.service) || freshRequire('./code-perception');
    const result = await service.exploreCode((args && args.query) || '', {
        focusId: args && args.focusId,
        includeSource: !(args && args.includeSource === false),
        includeImpact: !(args && args.includeImpact === false),
        maxResults: Number(args && args.maxResults) || 10,
    });
    // Unified error model (spec §3.1 / §4). Capability gaps are SUCCESS-shaped
    // (result.ok === true) and returned verbatim — never isError. But result.ok
    // === false is the service's ONLY signal of a true fatal (internal invariant /
    // adapter break with no fallback). The CallTool handler sets isError:true ONLY
    // when the tool handler throws, so a fatal must throw here rather than be wrapped
    // as a success envelope. The diagnostics travel in the error message.
    if (result && result.ok === false) {
        const reasons = (result.diagnostics || []).map(d => d.message || d.code).filter(Boolean).join('; ');
        const err = new Error(`code explore failed: ${reasons || 'internal invariant error'}`);
        err.result = result;
        throw err;
    }
    return result;
}

// ── Dispatch ──────────────────────────────────────────────────────────────────

async function dispatch(name, args) {
    switch (name) {
        case 'evo_recall':            return handleRecall(args);
        case 'evo_verify':            return handleVerify();
        case 'evo_plan_status':       return handlePlanStatus();
        case 'evo_architecture_status': return handleArchitectureStatus();
        case 'evo_drift_status':      return handleDriftStatus();
        case 'evo_active_context':    return handleActiveContext();
        case 'evo_code_explore':      return handleCodeExplore(args);
        default: throw new Error(`Unknown tool: ${name}`);
    }
}

// ── Server bootstrap ──────────────────────────────────────────────────────────

async function runMcpServer() {
    try { require('./db').getDb(); } catch (_) {}

    const server = new Server(
        { name: 'evo-lite', version: require('./runtime').getRuntimeVersion() },
        { capabilities: { tools: {} } },
    );

    server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));

    server.setRequestHandler(CallToolRequestSchema, async (request) => {
        const { name, arguments: args } = request.params;
        try {
            const result = await dispatch(name, args || {});
            return {
                content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
            };
        } catch (err) {
            return {
                content: [{ type: 'text', text: `Error: ${err.message}` }],
                isError: true,
            };
        }
    });

    const transport = new StdioServerTransport();
    await server.connect(transport);

    process.once('SIGINT', async () => { await server.close(); process.exit(0); });
    process.once('SIGTERM', async () => { await server.close(); process.exit(0); });
}

module.exports = { runMcpServer, TOOLS, handleCodeExplore, __freshRequire: freshRequire };
