'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFileSync, spawnSync } = require('child_process');
const { parsePlanFile, parseSpecFile } = require('./parse-markdown');
const { parseGovernanceContract, validateGovernanceContract } = require('./governance-contract');

const LEDGER_VERSION = 'evo-freeze-ledger@1';
const REMEDIATION_CHOICES = [
    'continue-governance',
    'downgrade-nonblocking-debt',
    'resume-authorized-execution',
];

function sha256(value) {
    return crypto.createHash('sha256').update(value).digest('hex');
}

function git(projectRoot, args, options = {}) {
    return execFileSync('git', args, {
        cwd: projectRoot,
        encoding: options.encoding === null ? null : 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
    });
}

function gitSucceeds(projectRoot, args) {
    return spawnSync('git', args, {
        cwd: projectRoot,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
    }).status === 0;
}

function ledgerPath(projectRoot) {
    return path.join(projectRoot, '.evo-lite', 'governance', 'freeze-ledger.json');
}

function normalizeArtifactPath(projectRoot, artifactPath) {
    if (typeof artifactPath !== 'string' || artifactPath.trim() === '') {
        throw new Error('artifact path is required');
    }
    const root = path.resolve(projectRoot);
    const absolute = path.resolve(root, artifactPath);
    const relative = path.relative(root, absolute);
    if (!relative || relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
        throw new Error('artifact path must resolve inside the workspace');
    }
    return { absolute, relative: relative.split(path.sep).join('/') };
}

function parseArtifact(absolute, relative, markdown) {
    const parsed = relative.includes('/plans/') ? parsePlanFile(absolute) : parseSpecFile(absolute);
    if (!parsed || typeof parsed.id !== 'string') throw new Error('artifact must have a valid plan/spec frontmatter id');
    const contractResult = parseGovernanceContract(markdown);
    if (!contractResult.present) throw new Error('artifact has no Governance Contract');
    if (contractResult.error) throw new Error(`Governance Contract is invalid: ${contractResult.error}`);
    const findings = validateGovernanceContract(contractResult.contract, {
        filePath: relative,
        parsedArtifact: parsed,
    });
    if (findings.length > 0) {
        throw new Error(`Governance Contract validation failed: ${findings.map(f => f.code).join(', ')}`);
    }
    return { artifactId: parsed.id, contract: contractResult.contract };
}

function readFreezeLedger(projectRoot) {
    const file = ledgerPath(projectRoot);
    if (!fs.existsSync(file)) return { version: LEDGER_VERSION, entries: [] };
    let parsed;
    try {
        parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch (err) {
        throw new Error(`freeze ledger is invalid JSON: ${err && err.message ? err.message : String(err)}`);
    }
    if (!parsed || parsed.version !== LEDGER_VERSION || !Array.isArray(parsed.entries)) {
        throw new Error(`freeze ledger must use ${LEDGER_VERSION} with an entries array`);
    }
    const seen = new Set();
    for (const entry of parsed.entries) {
        if (!entry || typeof entry.path !== 'string' || seen.has(entry.path)
            || !/^[0-9a-f]{40}$/.test(entry.freezeCommit || '')
            || !/^[0-9a-f]{64}$/.test(entry.contentSha256 || '')
            || !/^[0-9a-f]{64}$/.test(entry.contractDigest || '')) {
            throw new Error('freeze ledger contains an invalid or duplicate entry');
        }
        seen.add(entry.path);
    }
    return parsed;
}

function writeFreezeLedger(projectRoot, ledger) {
    const file = ledgerPath(projectRoot);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, `${JSON.stringify(ledger, null, 2)}\n`, 'utf8');
}

function freezeArtifact(projectRoot, artifactPath, options = {}) {
    const target = normalizeArtifactPath(projectRoot, artifactPath);
    if (!fs.existsSync(target.absolute) || !fs.statSync(target.absolute).isFile()) {
        throw new Error('artifact must be an existing file');
    }
    if (!gitSucceeds(projectRoot, ['ls-files', '--error-unmatch', '--', target.relative])) {
        throw new Error('artifact must be tracked at HEAD before it can be frozen');
    }
    const status = String(git(projectRoot, ['status', '--porcelain', '--', target.relative])).trim();
    if (status) throw new Error('artifact must be clean before it can be frozen');
    const head = String(git(projectRoot, ['rev-parse', 'HEAD'])).trim();
    if (!/^[0-9a-f]{40}$/.test(head)) throw new Error('git HEAD is unavailable');
    if (!gitSucceeds(projectRoot, ['cat-file', '-e', `${head}:${target.relative}`])) {
        throw new Error('artifact does not exist at HEAD');
    }
    const bytes = fs.readFileSync(target.absolute);
    const headBytes = git(projectRoot, ['show', `${head}:${target.relative}`], { encoding: null });
    if (!bytes.equals(headBytes)) throw new Error('artifact bytes differ from HEAD');
    const markdown = bytes.toString('utf8');
    const parsed = parseArtifact(target.absolute, target.relative, markdown);
    const contentSha256 = sha256(bytes);
    const contractDigest = sha256(JSON.stringify(parsed.contract));
    const current = readFreezeLedger(projectRoot);
    const existingIndex = current.entries.findIndex(entry => entry.path === target.relative);
    if (existingIndex >= 0) {
        const existing = current.entries[existingIndex];
        if (existing.contentSha256 === contentSha256 && existing.contractDigest === contractDigest) return existing;
        if (!options.replace) throw new Error('freeze entry has different content; pass --replace explicitly');
    }
    const entry = {
        path: target.relative,
        artifactId: parsed.artifactId,
        contentSha256,
        freezeCommit: head,
        contractDigest,
        frozenAt: new Date().toISOString(),
    };
    const entries = current.entries.slice();
    if (existingIndex >= 0) entries[existingIndex] = entry;
    else entries.push(entry);
    entries.sort((a, b) => a.path.localeCompare(b.path));
    writeFreezeLedger(projectRoot, { version: LEDGER_VERSION, entries });
    return entry;
}

function resolveUpstream(projectRoot, requested) {
    if (requested) return requested;
    try {
        return String(git(projectRoot, ['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{upstream}'])).trim();
    } catch (_) {
        return 'HEAD';
    }
}

function findIntroducingMerge(projectRoot, freezeCommit, upstreamRef) {
    let commits;
    try {
        commits = String(git(projectRoot, ['rev-list', '--first-parent', '--reverse', upstreamRef]))
            .split(/\r?\n/).filter(Boolean);
    } catch (_) {
        return null;
    }
    for (const commit of commits) {
        const parts = String(git(projectRoot, ['rev-list', '--parents', '-n', '1', commit])).trim().split(/\s+/);
        if (parts.length < 3) continue;
        const firstParent = parts[1];
        if (gitSucceeds(projectRoot, ['merge-base', '--is-ancestor', freezeCommit, commit])
            && !gitSucceeds(projectRoot, ['merge-base', '--is-ancestor', freezeCommit, firstParent])) return commit;
    }
    return null;
}

function loadEvidence(projectRoot, artifactId) {
    const file = path.join(projectRoot, '.evo-lite', 'generated', 'planning', 'plan-ir.json');
    if (!fs.existsSync(file)) return [];
    try {
        const ir = JSON.parse(fs.readFileSync(file, 'utf8'));
        const evidence = new Set();
        for (const task of (Array.isArray(ir.tasks) ? ir.tasks : [])) {
            if (task && (task.linkedPlan === artifactId || task.linkedSpec === artifactId)) {
                for (const item of (Array.isArray(task.evidence) ? task.evidence : [])) evidence.add(item);
            }
        }
        return Array.from(evidence).sort();
    } catch (_) {
        return [];
    }
}

function frozenBudget(projectRoot, entry) {
    try {
        const markdown = String(git(projectRoot, ['show', `${entry.freezeCommit}:${entry.path}`]));
        const parsed = parseGovernanceContract(markdown);
        return parsed.present && !parsed.error ? parsed.contract.remediationBudget : 0;
    } catch (_) {
        return 0;
    }
}

function remediationCommits(projectRoot, entry, boundary) {
    if (!boundary || !gitSucceeds(projectRoot, ['merge-base', '--is-ancestor', entry.freezeCommit, boundary])) return [];
    try {
        return String(git(projectRoot, ['rev-list', '--reverse', `${entry.freezeCommit}..${boundary}`, '--', entry.path]))
            .split(/\r?\n/).filter(Boolean);
    } catch (_) {
        return [];
    }
}

function inspectFreezeLedger(projectRoot, options = {}) {
    const ledger = readFreezeLedger(projectRoot);
    const head = String(git(projectRoot, ['rev-parse', 'HEAD'])).trim();
    const upstreamRef = resolveUpstream(projectRoot, options.upstreamRef);
    const entries = ledger.entries.map(entry => {
        const absolute = path.join(projectRoot, ...entry.path.split('/'));
        const contentState = !fs.existsSync(absolute)
            ? 'missing'
            : (sha256(fs.readFileSync(absolute)) === entry.contentSha256 ? 'match' : 'mismatch');
        const ancestorOfHead = gitSucceeds(projectRoot, ['merge-base', '--is-ancestor', entry.freezeCommit, head]);
        const mergeCommit = findIntroducingMerge(projectRoot, entry.freezeCommit, upstreamRef);
        const commits = remediationCommits(projectRoot, entry, mergeCommit || head);
        const budget = frozenBudget(projectRoot, entry);
        const exceeded = commits.length > budget;
        return {
            ...entry,
            contentState,
            ancestorOfHead,
            mergeCommit,
            evidence: loadEvidence(projectRoot, entry.artifactId),
            remediation: {
                budget,
                used: commits.length,
                commits,
                status: exceeded ? 'budget-exceeded' : 'within-budget',
                choices: exceeded ? REMEDIATION_CHOICES.slice() : [],
            },
        };
    });
    return { version: 'evo-freeze-report@1', head, upstreamRef, entries };
}

module.exports = {
    LEDGER_VERSION,
    REMEDIATION_CHOICES,
    freezeArtifact,
    readFreezeLedger,
    inspectFreezeLedger,
};
