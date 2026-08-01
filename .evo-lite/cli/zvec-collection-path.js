'use strict';
// Where the Zvec collection lives — computed WITHOUT loading @zvec/zvec.
//
// Frozen contract: docs/specs/zvec-win-unicode-containment.md §6.2.
//
// WHY THIS IS A SEPARATE MODULE
// The containment decision has to know the exact path that would be handed to
// ZVecOpen/ZVecCreateAndOpen (I10) *before* anything loads the native binding
// (I1). The authoritative computation already existed — zvecRoot() in
// memory-index-zvec.js — but that function is not exported, and requiring that
// module from the selector to reach it would defeat the point of deciding first.
//
// So the computation is lifted here, into a module that depends on nothing but
// `path` and the runtime's own path resolution. memory-index-zvec.js keeps its
// internal copy for now (it is out of scope this round), which makes these two
// definitions a divergence risk: if they ever disagree, containment would be
// classifying a path the engine does not actually use, and would silently guard
// nothing. T-zwuc-T4-path-agreement pins them together by constructing the real
// ZvecMemoryIndex and comparing its _colPath against zvecCollectionPath().
// Collapsing the duplicate belongs to the round that may edit memory-index-zvec.

const path = require('path');
const { getDbPath } = require('./runtime');

// Mirrors memory-index-zvec.js: dirname(getDbPath())/zvec, collection inside it.
const ZVEC_DIR_NAME = 'zvec';
const COLLECTION_DIR_NAME = 'collection';

/**
 * Directory holding the collection plus its sidecars (id counter, lock).
 * @param {string} [dbPath] override, for tests; defaults to the live runtime db
 */
function zvecRootDir(dbPath) {
    return path.join(path.dirname(dbPath === undefined ? getDbPath() : dbPath), ZVEC_DIR_NAME);
}

/**
 * The exact path passed to ZVecOpen / ZVecCreateAndOpen. This is the string the
 * containment classifier must judge — not the project root, not the runtime root.
 * @param {string} [dbPath] override, for tests; defaults to the live runtime db
 */
function zvecCollectionPath(dbPath) {
    return path.join(zvecRootDir(dbPath), COLLECTION_DIR_NAME);
}

module.exports = { zvecRootDir, zvecCollectionPath, ZVEC_DIR_NAME, COLLECTION_DIR_NAME };
