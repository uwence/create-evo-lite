'use strict';

const fs = require('fs');
const path = require('path');

// Same shape of guard as evidence-store.evidenceSlug: the id lands in filenames
// and registry keys, so it must never carry a path separator or `..`.
function validChildId(id) {
    return typeof id === 'string' && /^[a-z0-9._-]+$/i.test(id) && !id.includes('..');
}

function hiveDir(root) {
    return path.join(root, '.evo-lite', 'hive');
}

function registryPath(root) {
    return path.join(hiveDir(root), 'children.json');
}

function readRegistry(root) {
    const fp = registryPath(root);
    if (!fs.existsSync(fp)) {
        return { version: 'evo-hive-registry@1', children: [] };
    }
    return JSON.parse(fs.readFileSync(fp, 'utf8'));
}

function writeRegistry(root, registry) {
    const fp = registryPath(root);
    fs.mkdirSync(path.dirname(fp), { recursive: true });
    fs.writeFileSync(fp, JSON.stringify(registry, null, 2) + '\n');
    return fp;
}

function findChild(root, id) {
    return readRegistry(root).children.find(c => c.id === id) || null;
}

function registerChild(root, childPath, options = {}) {
    const now = options.now || (() => new Date().toISOString());
    const resolved = path.resolve(childPath);
    const id = options.id || path.basename(resolved);
    if (!validChildId(id)) {
        throw new Error(`invalid child id: ${id} (allowed: letters, digits, . _ -, no "..")`);
    }
    if (!fs.existsSync(path.join(resolved, '.evo-lite', 'cli')) ||
        !fs.existsSync(path.join(resolved, '.evo-lite', 'package.json'))) {
        throw new Error(`not an evo-lite child (needs .evo-lite/cli and .evo-lite/package.json): ${resolved}`);
    }
    const registry = readRegistry(root);
    const existing = registry.children.find(c => c.id === id);
    if (existing) {
        existing.path = resolved.replace(/\\/g, '/');
    } else {
        registry.children.push({
            id,
            path: resolved.replace(/\\/g, '/'),
            registeredAt: now(),
            lastNurturedAt: null,
            lastNurturedVersion: null,
        });
    }
    writeRegistry(root, registry);
    return registry.children.find(c => c.id === id);
}

module.exports = { validChildId, hiveDir, registryPath, readRegistry, writeRegistry, registerChild, findChild };
