'use strict';

// GitHub Issues planning provider.
// Scans Planning IR task verify lines for issue:#N references and enriches
// matching tasks with issueRefs queried from GitHub via gh CLI.
// Architecture scan() is a no-op — this provider enriches Planning IR only.
// Requires: gh CLI installed and authenticated (gh auth status).

const { execSync } = require('child_process');

const ISSUE_PATTERN = /(?:issue:)?#(\d+)/gi;

function ghAuthenticated() {
    try {
        execSync('gh auth status', { stdio: 'ignore' });
        return true;
    } catch (_) { return false; }
}

module.exports = {
    id: 'provider:github-issues',
    name: 'GitHub Issues',
    version: '1',

    check() {
        try { execSync('gh --version', { stdio: 'ignore' }); } catch (_) { return false; }
        return (!!process.env.GH_TOKEN || !!process.env.GITHUB_TOKEN || ghAuthenticated());
    },

    // No-op for architecture IR — this provider only enriches Planning IR
    scan() {
        return { modules: [], files: [], edges: [], flows: [] };
    },

    scanPlanning(root, planIR) {
        const enrichedTasks = [];

        for (const task of (planIR.tasks || [])) {
            const issueNums = new Set();
            for (const v of (task.verify || [])) {
                const str = typeof v === 'string' ? v : String(v);
                let match;
                ISSUE_PATTERN.lastIndex = 0;
                while ((match = ISSUE_PATTERN.exec(str)) !== null) {
                    issueNums.add(Number(match[1]));
                }
            }

            if (issueNums.size === 0) continue;

            const issueRefs = [];
            for (const num of issueNums) {
                try {
                    const raw = execSync(
                        `gh issue view ${num} --json number,title,state`,
                        { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }
                    );
                    const issue = JSON.parse(raw);
                    issueRefs.push({ number: issue.number, title: issue.title, state: issue.state });
                } catch (_) {
                    issueRefs.push({ number: num });
                }
            }

            enrichedTasks.push({ ...task, issueRefs });
        }

        return { tasks: enrichedTasks };
    },
};
