'use strict';
// The frozen contract this apparatus claims to check, shared by every runner.
//
// Extracted so that "the bridge runs the SAME 19 checks as Step 2B" is a
// structural fact rather than a promise. Two copies of a frozen set are two
// sets that can drift, and the drift would be invisible: both files would still
// report their own contents as complete.
//
// Frozen as a SET, not a count — a count still passes when one check is
// duplicated and another deleted.
module.exports = {
    EXPECTED_CHECKS: {
        A: [
            'upsert returns numeric id',
            'ids are distinct and ascending',
        ],
        B: [
            'write survives close + reopen in a new process',
            'list is ordered by numeric id',
            'list carries content/namespace/timestamp',
            'fts query returns the expected row',
            'fts match_source is zvec-fts',
            'fts row has score and snippet',
            'colon query returns the expected row',
            'colon query falls back to zvec-match',
            'scope filter excludes the out-of-scope row',
            'scope filter keeps the in-scope row (positive control)',
            'stats counts both docs',
            'stats first/last timestamps',
            'stats namespaces reports per-namespace chunks',
            'delete reports changes = 1',
        ],
        C: [
            'deletion survives reopen',
            'survivor still present',
            'survivor still queryable after reopen',
        ],
    },
};
