'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

function validateGitRef(ref, projectRoot) {
    const sha = ref.replace(/^git:/i, '');
    if (!/^[a-f0-9]{4,40}$/i.test(sha)) {
        return { ref, valid: false, summary: null };
    }
    try {
        const out = execFileSync('git', ['show', '--stat', '--oneline', sha], {
            cwd: projectRoot, encoding: 'utf8', timeout: 5000,
        });
        return { ref, valid: true, summary: out.split('\n')[0].trim() };
    } catch {
        return { ref, valid: false, summary: null };
    }
}

function checkLinkedFiles(linkedFiles, projectRoot) {
    if (!linkedFiles || linkedFiles.length === 0) {
        return { ratio: 1.0, total: 0, exist: 0 };
    }
    const exist = linkedFiles.filter(f => fs.existsSync(path.join(projectRoot, f))).length;
    return { ratio: exist / linkedFiles.length, total: linkedFiles.length, exist };
}

function checkArchiveHits(taskId, projectRoot) {
    const rawDir = path.join(projectRoot, '.evo-lite', 'raw_memory');
    if (!fs.existsSync(rawDir)) return 0;
    const slug = taskId.replace(/^task:/, '');
    if (!slug) return 0;
    return fs.readdirSync(rawDir).filter(f => f.endsWith('.md') && f.includes(slug)).length;
}

function evaluateTask(task, projectRoot) {
    const evidenceRefs = (task.evidence || []).filter(e => /^git:[a-f0-9]+/i.test(e));
    const gitRefs = evidenceRefs.map(ref => validateGitRef(ref, projectRoot));
    const validGitRefs = gitRefs.filter(r => r.valid).length;

    const filesResult = checkLinkedFiles(task.linkedFiles, projectRoot);
    const hasPositiveFileEvidence = filesResult.total > 0 && filesResult.exist > 0;
    const hasPositiveEvidence = validGitRefs >= 1 || hasPositiveFileEvidence;
    const archiveHits = checkArchiveHits(task.id, projectRoot);

    let derivedStatus, confidence;
    if (task.status === 'implemented') {
        if (validGitRefs >= 1 && (filesResult.total === 0 || filesResult.ratio === 1.0)) {
            derivedStatus = 'verified';
            confidence = 0.95;
        } else if (hasPositiveEvidence) {
            derivedStatus = 'implemented';
            confidence = 0.80;
        } else {
            derivedStatus = 'implemented';
            confidence = 0.50;
        }
    } else {
        if (hasPositiveEvidence) {
            derivedStatus = 'in_progress';
            confidence = 0.40;
        } else {
            derivedStatus = 'todo';
            confidence = 0.00;
        }
    }

    confidence = Math.round(Math.min(confidence + archiveHits * 0.02, 1.0) * 100) / 100;

    return {
        id: task.id,
        title: task.title,
        linkedPlan: task.linkedPlan || null,
        checkboxStatus: task.status,
        derivedStatus,
        confidence,
        evidence: {
            gitRefs,
            linkedFilesRatio: filesResult.ratio,
            linkedFilesTotal: filesResult.total,
            linkedFilesExist: filesResult.exist,
            archiveHits,
        },
    };
}

function evaluateProgress(projectRoot) {
    const irPath = path.join(projectRoot, '.evo-lite', 'generated', 'planning', 'plan-ir.json');
    if (!fs.existsSync(irPath)) return null;

    let ir;
    try { ir = JSON.parse(fs.readFileSync(irPath, 'utf8')); } catch { return null; }
    const tasks = (ir.tasks || []).map(t => evaluateTask(t, projectRoot));

    const count = { verified: 0, implemented: 0, in_progress: 0, todo: 0 };
    for (const t of tasks) { if (count[t.derivedStatus] !== undefined) count[t.derivedStatus]++; }

    const byPlan = {};
    for (const t of tasks) {
        const pid = t.linkedPlan || 'unknown';
        if (!byPlan[pid]) byPlan[pid] = { total: 0, verified: 0, implemented: 0, in_progress: 0, todo: 0 };
        byPlan[pid].total++;
        if (byPlan[pid][t.derivedStatus] !== undefined) byPlan[pid][t.derivedStatus]++;
    }

    return {
        version: 'evo-progress@1',
        generatedAt: new Date().toISOString(),
        planIrPath: path.relative(projectRoot, irPath).replace(/\\/g, '/'),
        summary: { total: tasks.length, ...count },
        byPlan,
        tasks,
    };
}

function writeProgressReport(report, projectRoot) {
    const outDir = path.join(projectRoot, '.evo-lite', 'generated', 'planning');
    fs.mkdirSync(outDir, { recursive: true });
    const outPath = path.join(outDir, 'progress-report.json');
    fs.writeFileSync(outPath, JSON.stringify(report, null, 2), 'utf8');
    return outPath;
}

module.exports = { evaluateProgress, writeProgressReport };
