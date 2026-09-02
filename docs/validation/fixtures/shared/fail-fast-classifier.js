'use strict';
// The verdict vocabulary for "did the uncatchable native fail-fast happen",
// single-sourced.
//
// It was frozen in Step 1's probe-runner.js (7628fdb) and every later layer
// inherits it rather than reinventing it. Step 2C's bridge initially DID
// reinvent it, and the drift was not cosmetic:
//
//     Step 1   timedOut -> INCONCLUSIVE
//     bridge   timedOut -> triggerReproduced = true
//
// A hung 0.6.0 would have been accepted as "the trigger reproduced", and the
// subject would then have run and been allowed to reach SATISFIED on a cell
// where nothing was ever shown to crash. A timeout is the absence of an
// observation, not an observation of death.
//
// `completed` is the caller's own evidence that the child reported finishing -
// Step 1 reads its stage log for `child_done`, the bridge reads the phase
// evidence file. Generalising that one input is what lets both hosts share the
// classification instead of each writing its own.

const REPRODUCED = 'FAIL_FAST_REPRODUCED';

function classifyNativeOutcome({ timedOut, jsError, status, signal, completed }) {
    if (timedOut) return 'INCONCLUSIVE';
    if (jsError) return 'NORMAL_JS_ERROR';
    if (status === 0 && completed) return 'COMPLETED_NO_FAILFAST';
    // 0xC0000409 == 3221226505 unsigned. Any abnormal teardown with no JS-level
    // error means JavaScript never regained control: a native fail-fast.
    if (status === 3221226505 || status === -1073740791) return REPRODUCED;
    if (signal) return REPRODUCED;
    if (status !== 0 && !jsError) return REPRODUCED;
    return 'INCONCLUSIVE';
}

module.exports = { classifyNativeOutcome, REPRODUCED };
