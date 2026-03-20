const fs = require('fs');
const path = require('path');

function getRuntimeRoot() {
    if (process.env.EVO_LITE_ROOT) {
        return path.resolve(process.env.EVO_LITE_ROOT);
    }
    return path.resolve(__dirname, '..');
}

function getWorkspaceRoot() {
    return path.resolve(getRuntimeRoot(), '..');
}

function getCliDir() {
    return path.join(getRuntimeRoot(), 'cli');
}

function getDbPath() {
    if (process.env.EVO_LITE_DB_PATH) {
        return path.resolve(process.env.EVO_LITE_DB_PATH);
    }
    return path.join(getRuntimeRoot(), 'memory.db');
}

function getCacheDir() {
    if (process.env.EVO_LITE_CACHE_DIR) {
        return path.resolve(process.env.EVO_LITE_CACHE_DIR);
    }
    return path.join(getRuntimeRoot(), '.cache');
}

function getActiveContextPath() {
    return path.join(getRuntimeRoot(), 'active_context.md');
}

function getLogPath() {
    return path.join(getRuntimeRoot(), 'memory.log');
}

function getOfflineMemoriesPath() {
    return path.join(getRuntimeRoot(), 'offline_memories.json');
}

function getRerankerStatePath() {
    return path.join(getRuntimeRoot(), 'reranker_state.json');
}

function getRawMemoryDir() {
    return path.join(getRuntimeRoot(), 'raw_memory');
}

function getVectMemoryDir() {
    return path.join(getRuntimeRoot(), 'vect_memory');
}

function getWalkthroughsDir() {
    return path.join(getRuntimeRoot(), 'walkthroughs');
}

function ensureDir(dirPath) {
    if (!fs.existsSync(dirPath)) {
        fs.mkdirSync(dirPath, { recursive: true });
    }
}

function getTemplateCliDir() {
    const explicit = process.env.EVO_LITE_TEMPLATE_CLI_DIR;
    if (explicit) {
        const resolved = path.resolve(explicit);
        return fs.existsSync(resolved) ? resolved : null;
    }

    const candidates = [
        path.join(getWorkspaceRoot(), 'templates', 'cli'),
        path.join(getRuntimeRoot(), 'templates', 'cli'),
    ];

    for (const candidate of candidates) {
        if (fs.existsSync(candidate)) {
            return candidate;
        }
    }

    return null;
}

function getTemplateRootDir() {
    const explicit = process.env.EVO_LITE_TEMPLATE_ROOT_DIR;
    if (explicit) {
        const resolved = path.resolve(explicit);
        return fs.existsSync(resolved) ? resolved : null;
    }

    const cliDir = getTemplateCliDir();
    if (cliDir) {
        return path.dirname(cliDir);
    }

    const candidates = [
        path.join(getWorkspaceRoot(), 'templates'),
        path.join(getRuntimeRoot(), 'templates'),
    ];

    for (const candidate of candidates) {
        if (fs.existsSync(candidate)) {
            return candidate;
        }
    }

    return null;
}

module.exports = {
    ensureDir,
    getActiveContextPath,
    getCacheDir,
    getCliDir,
    getDbPath,
    getLogPath,
    getOfflineMemoriesPath,
    getRerankerStatePath,
    getRawMemoryDir,
    getRuntimeRoot,
    getTemplateCliDir,
    getTemplateRootDir,
    getVectMemoryDir,
    getWalkthroughsDir,
    getWorkspaceRoot,
};
