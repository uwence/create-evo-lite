'use strict';

// wiki-groups.json (evo-wiki-groups@1) — display-only grouping (design §2.2).
// Validation failure returns { ok:false, errors } which the CLI maps to exit 2.
// Aliases and lane labels affect DISPLAY only; module identity never changes.

const fs = require('node:fs');
const path = require('node:path');

const GROUPS_VERSION = 'evo-wiki-groups@1';

function isPlainObject(v) { return v !== null && typeof v === 'object' && !Array.isArray(v); }

function loadWikiGroups(projectRoot, knownModuleIds) {
    const file = path.join(projectRoot, '.evo-lite', 'wiki-groups.json');
    if (!fs.existsSync(file)) return { ok: true, config: null };

    let raw;
    try { raw = JSON.parse(fs.readFileSync(file, 'utf8')); }
    catch (e) { return { ok: false, errors: [`wiki-groups.json is not valid JSON: ${e.message}`] }; }

    const errors = [];
    if (!isPlainObject(raw)) return { ok: false, errors: ['wiki-groups.json must be an object'] };
    if (raw.version !== GROUPS_VERSION) errors.push(`unknown version: ${raw.version} (expected ${GROUPS_VERSION})`);
    const laneLabels = raw.laneLabels === undefined ? {} : raw.laneLabels;
    const moduleAliases = raw.moduleAliases === undefined ? {} : raw.moduleAliases;
    if (!isPlainObject(laneLabels)) errors.push('laneLabels must be an object');
    if (!isPlainObject(moduleAliases)) errors.push('moduleAliases must be an object');
    const groups = raw.groups === undefined ? [] : raw.groups;
    if (!Array.isArray(groups)) errors.push('groups must be an array');

    const known = new Set(knownModuleIds || []);
    const seen = new Map();
    if (Array.isArray(groups)) {
        for (const g of groups) {
            if (!isPlainObject(g) || typeof g.id !== 'string' || typeof g.name !== 'string'
                || typeof g.order !== 'number' || !Array.isArray(g.moduleIds)
                || g.moduleIds.some(id => typeof id !== 'string')) {
                errors.push(`group entry malformed: ${JSON.stringify(g).slice(0, 80)}`);
                continue;
            }
            for (const id of g.moduleIds) {
                if (!known.has(id)) errors.push(`unknown module id in ${g.id}: ${id}`);
                // duplicate = ANY second occurrence, same group or another group
                if (seen.has(id)) errors.push(`duplicate module id: ${id} (${seen.get(id)}, ${g.id})`);
                else seen.set(id, g.id);
            }
        }
    }
    if (isPlainObject(laneLabels)) {
        for (const [k, v] of Object.entries(laneLabels)) {
            if (typeof v !== 'string') errors.push(`laneLabels.${k} must be a string`);
        }
    }
    if (isPlainObject(moduleAliases)) {
        for (const [id, v] of Object.entries(moduleAliases)) {
            if (typeof v !== 'string') errors.push(`moduleAliases.${id} must be a string`);
            if (!known.has(id)) errors.push(`moduleAliases references unknown module id: ${id}`);
        }
    }

    if (errors.length) return { ok: false, errors };
    const sorted = [...groups].sort((a, b) => (a.order - b.order) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    return { ok: true, config: { laneLabels, moduleAliases, groups: sorted } };
}

module.exports = { loadWikiGroups, GROUPS_VERSION };
