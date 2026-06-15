'use strict';

// GitNexus architecture provider.
// Reads .gitnexus/meta.json to identify which project files were indexed,
// then boosts confidence for those files and their parent modules in the native IR.
// Requires: .gitnexus/meta.json present (created by `npx gitnexus analyze`).

const fs = require('fs');
const path = require('path');

const GITNEXUS_CONFIDENCE = 0.9;

module.exports = {
    id: 'provider:gitnexus',
    name: 'GitNexus',
    version: '1',

    check() {
        const metaPath = path.join(process.cwd(), '.gitnexus', 'meta.json');
        return fs.existsSync(metaPath);
    },

    scan(root, nativeIR) {
        const metaPath = path.join(root, '.gitnexus', 'meta.json');
        const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));

        const indexedFiles = new Set(
            Object.keys(meta.fileHashes || {}).map(f => f.replace(/\\/g, '/'))
        );

        // Files: boost confidence for anything GitNexus has indexed
        const enrichedFiles = nativeIR.files
            .filter(f => indexedFiles.has(f.path))
            .map(f => ({
                ...f,
                confidence: Math.max(f.confidence || 0, GITNEXUS_CONFIDENCE),
                provider: 'provider:gitnexus',
            }));

        // Modules: boost confidence for modules that own indexed files
        const boostedModuleIds = new Set(enrichedFiles.map(f => f.module).filter(Boolean));
        const enrichedModules = nativeIR.modules
            .filter(m => boostedModuleIds.has(m.id))
            .map(m => ({
                ...m,
                confidence: Math.max(m.confidence || 0, GITNEXUS_CONFIDENCE),
                provider: 'provider:gitnexus',
            }));

        return {
            modules: enrichedModules,
            files: enrichedFiles,
            edges: [],
            flows: [],
            confidence: GITNEXUS_CONFIDENCE,
            meta: {
                indexedAt: meta.indexedAt,
                indexedFileCount: indexedFiles.size,
                totalNodes: meta.stats && meta.stats.nodes,
            },
        };
    },
};
