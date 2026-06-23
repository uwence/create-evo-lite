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

function getRuntimeVersion() {
    // Version lives in the runtime's own manifest (.evo-lite/package.json), written
    // by the initializer. Never read the host project's root package.json — that
    // crashes non-Node hosts and misreports the host app version as Evo-Lite's.
    try {
        const pkgPath = path.join(getRuntimeRoot(), 'package.json');
        return JSON.parse(fs.readFileSync(pkgPath, 'utf8')).version || 'unknown';
    } catch (_) {
        return 'unknown';
    }
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

function getIndexStatePath() {
    return path.join(getRuntimeRoot(), 'index_state.json');
}

function getRawMemoryDir() {
    return path.join(getRuntimeRoot(), 'raw_memory');
}

function migrateLegacyIndexMemoryDir() {
    const modernDir = path.join(getRuntimeRoot(), 'index_memory');
    const legacyDir = path.join(getRuntimeRoot(), 'vect_memory');

    if (!fs.existsSync(legacyDir)) {
        return modernDir;
    }

    if (fs.existsSync(modernDir)) {
        return modernDir;
    }

    try {
        fs.renameSync(legacyDir, modernDir);
        return modernDir;
    } catch (_) {
        return legacyDir;
    }
}

function getIndexMemoryDir() {
    return migrateLegacyIndexMemoryDir();
}

function getVectMemoryDir() {
    return getIndexMemoryDir();
}

function getRerankerStatePath() {
    return getIndexStatePath();
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

function getEvoConfig() {
    const configPath = path.join(getRuntimeRoot(), 'config.json');
    if (!fs.existsSync(configPath)) return { providers: [] };
    try {
        return JSON.parse(fs.readFileSync(configPath, 'utf8'));
    } catch (_) {
        return { providers: [] };
    }
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
    getEvoConfig,
    getIndexMemoryDir,
    getIndexStatePath,
    getLogPath,
    getOfflineMemoriesPath,
    getRerankerStatePath,
    getRawMemoryDir,
    getRuntimeRoot,
    getRuntimeVersion,
    getTemplateCliDir,
    getTemplateRootDir,
    migrateLegacyIndexMemoryDir,
    getVectMemoryDir,
    getWalkthroughsDir,
    getWorkspaceRoot,
};
