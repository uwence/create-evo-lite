const fs = require('fs');
const path = require('path');
const { getWorkspaceRoot } = require('./runtime');

function readJsonFile(filePath) {
    try {
        if (!fs.existsSync(filePath)) {
            return { exists: false };
        }
        return {
            data: JSON.parse(fs.readFileSync(filePath, 'utf8')),
            exists: true,
        };
    } catch (error) {
        return {
            error: error.message,
            exists: true,
        };
    }
}

function getConfigCandidates(workspaceRoot = getWorkspaceRoot()) {
    return [
        { scope: 'workspace', path: path.join(workspaceRoot, '.vscode', 'mcp.json') },
        { scope: 'workspace', path: path.join(workspaceRoot, '.cursor', 'mcp.json') },
        { scope: 'workspace', path: path.join(workspaceRoot, '.claude', 'settings.json') },
        { scope: 'workspace-local', path: path.join(workspaceRoot, '.claude', 'settings.local.json') },
    ];
}

function normalizeServers(config) {
    if (!config || typeof config !== 'object') {
        return {};
    }
    if (config.servers && typeof config.servers === 'object') {
        return config.servers;
    }
    if (config.mcpServers && typeof config.mcpServers === 'object') {
        return config.mcpServers;
    }
    return {};
}

function inferTransport(serverConfig) {
    if (!serverConfig || typeof serverConfig !== 'object') {
        return 'unknown';
    }
    if (serverConfig.url || serverConfig.type === 'http' || serverConfig.transport === 'http') {
        return 'http';
    }
    if (serverConfig.command === 'docker') {
        return 'docker';
    }
    if (serverConfig.command) {
        return 'stdio';
    }
    return 'unknown';
}

function inferCapabilities(name, serverConfig) {
    const haystack = `${name} ${serverConfig && serverConfig.command ? serverConfig.command : ''} ${(serverConfig && Array.isArray(serverConfig.args)) ? serverConfig.args.join(' ') : ''}`.toLowerCase();
    if (haystack.includes('gitnexus')) {
        return {
            category: 'code-intelligence',
            recommendedUse: '代码图谱、执行流、影响分析、重构/rename 安全检查。',
        };
    }
    if (haystack.includes('context-mode') || haystack.includes('contextmode')) {
        return {
            category: 'context-tools',
            recommendedUse: '大输出命令压缩、文件内容摘要、网页索引、跨压缩上下文保留。',
        };
    }
    if (haystack.includes('browser') || haystack.includes('playwright') || haystack.includes('gstack')) {
        return {
            category: 'browser-qa',
            recommendedUse: '浏览器交互、页面 QA、截图、前端回归验证。',
        };
    }
    if (haystack.includes('github')) {
        return {
            category: 'repository-ops',
            recommendedUse: 'GitHub issue、PR、仓库元数据和发布流程辅助。',
        };
    }
    if (haystack.includes('filesystem') || haystack.includes('file-system')) {
        return {
            category: 'filesystem',
            recommendedUse: '受控文件读取、写入或目录枚举。',
        };
    }
    return {
        category: 'general-mcp',
        recommendedUse: '按 MCP 工具说明选择使用；Evo-Lite 仅记录能力存在，不把它当成状态真源。',
    };
}

function toWorkspaceRelative(filePath, workspaceRoot = getWorkspaceRoot()) {
    return path.relative(workspaceRoot, filePath).replace(/\\/g, '/') || '.';
}

function detectMcpCapabilities(options = {}) {
    const workspaceRoot = options.workspaceRoot || getWorkspaceRoot();
    const configs = [];
    const servers = [];
    const errors = [];

    for (const candidate of getConfigCandidates(workspaceRoot)) {
        const loaded = readJsonFile(candidate.path);
        if (!loaded.exists) {
            continue;
        }

        const source = toWorkspaceRelative(candidate.path, workspaceRoot);
        if (loaded.error) {
            errors.push({ source, error: loaded.error });
            configs.push({ scope: candidate.scope, source, status: 'invalid', serverCount: 0 });
            continue;
        }

        const normalizedServers = normalizeServers(loaded.data);
        const names = Object.keys(normalizedServers);
        configs.push({ scope: candidate.scope, source, status: 'ok', serverCount: names.length });
        for (const name of names) {
            const serverConfig = normalizedServers[name] || {};
            const inferred = inferCapabilities(name, serverConfig);
            servers.push({
                argCount: Array.isArray(serverConfig.args) ? serverConfig.args.length : 0,
                category: inferred.category,
                command: serverConfig.command || null,
                name,
                recommendedUse: inferred.recommendedUse,
                source,
                status: 'configured',
                transport: inferTransport(serverConfig),
            });
        }
    }

    return {
        checkedAt: new Date().toISOString(),
        configs,
        errors,
        serverCount: servers.length,
        servers,
        workspaceRoot,
    };
}

function formatMcpReport(report, options = {}) {
    const lines = [
        `MCP configs: ${report.configs.length}`,
        `MCP servers: ${report.serverCount}`,
    ];
    if (report.configs.length === 0) {
        lines.push('No workspace MCP config files were found.');
    }
    for (const config of report.configs) {
        lines.push(`- config ${config.source}: ${config.status}, servers=${config.serverCount}`);
    }
    for (const error of report.errors) {
        lines.push(`- error ${error.source}: ${error.error}`);
    }
    for (const server of report.servers) {
        lines.push(`- ${server.name} [${server.category}/${server.transport}] from ${server.source}`);
        if (options.explain) {
            lines.push(`  use: ${server.recommendedUse}`);
        }
    }
    return lines.join('\n');
}

module.exports = {
    detectMcpCapabilities,
    formatMcpReport,
    inferCapabilities,
    normalizeServers,
};