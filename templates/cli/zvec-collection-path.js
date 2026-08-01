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
// `path` and the runtime's own path resolution — and memory-index-zvec.js
// CONSUMES it rather than keeping a second copy. That direction matters: a
// classifier and an engine that merely agree today are still two formulas, and
// the safety property required is "the path judged IS the path handed to
// ZVecOpen", not "the two happen to match".
//
// zvecPaths() returns both values from ONE root derivation so a caller can never
// pair a root from one evaluation with a collection path from another.

const path = require('path');
const { getDbPath } = require('./runtime');

const ZVEC_DIR_NAME = 'zvec';
const COLLECTION_DIR_NAME = 'collection';

/**
 * The single derivation. Both the containment decision and ZvecMemoryIndex read
 * their paths from here.
 *
 * @param {string} [dbPath] override, for tests; defaults to the live runtime db
 * @returns {{rootPath: string, collectionPath: string}}
 *   rootPath       directory holding the collection plus its sidecars (id counter, lock)
 *   collectionPath the exact string passed to ZVecOpen / ZVecCreateAndOpen — the
 *                  thing the classifier must judge (I10), not the project root
 */
function zvecPaths(dbPath) {
    const rootPath = path.join(path.dirname(dbPath === undefined ? getDbPath() : dbPath), ZVEC_DIR_NAME);
    return { rootPath, collectionPath: path.join(rootPath, COLLECTION_DIR_NAME) };
}

function zvecRootDir(dbPath) {
    return zvecPaths(dbPath).rootPath;
}

function zvecCollectionPath(dbPath) {
    return zvecPaths(dbPath).collectionPath;
}

module.exports = { zvecPaths, zvecRootDir, zvecCollectionPath, ZVEC_DIR_NAME, COLLECTION_DIR_NAME };
