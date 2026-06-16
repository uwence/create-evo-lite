'use strict';

const fs = require('fs');
const path = require('path');
const { parseFrontmatter } = require('./parse-markdown');

const PLAN_DIRS = [
    'docs/plans',
    'docs/superpowers/plans',
];

const SPEC_DIRS = [
    'docs/specs',
    'docs/superpowers/specs',
];

function collectSpecIds(projectRoot) {
    const ids = new Set();
    for (const dir of SPEC_DIRS) {
        const abs = path.join(projectRoot, dir);
        if (!fs.existsSync(abs)) continue;

        for (const fname of fs.readdirSync(abs)) {
            if (!fname.endsWith('.md')) continue;
            const filePath = path.join(abs, fname);
            const content = fs.readFileSync(filePath, 'utf8');
            const { frontmatter } = parseFrontmatter(content);
            if (frontmatter.id && frontmatter.id.startsWith('spec:')) {
                ids.add(frontmatter.id);
            }
        }
    }
    return ids;
}

function lintPlans(projectRoot, fix) {
    const issues = [];
    let fixed = 0;
    const specIds = collectSpecIds(projectRoot);

    for (const dir of PLAN_DIRS) {
        const abs = path.join(projectRoot, dir);
        if (!fs.existsSync(abs)) continue;

        for (const fname of fs.readdirSync(abs)) {
            if (!fname.endsWith('.md')) continue;

            const filePath = path.join(abs, fname);
            const relPath = path.relative(projectRoot, filePath).replace(/\\/g, '/');
            const content = fs.readFileSync(filePath, 'utf8');
            const { frontmatter } = parseFrontmatter(content);
            const hasFrontmatter = Object.keys(frontmatter).length > 0;

            if (!hasFrontmatter) {
                issues.push({
                    level: 'warning',
                    file: relPath,
                    message: 'no frontmatter — add id: plan:<slug> and linkedSpec: spec:<slug>',
                });

                if (fix) {
                    const slug = fname.replace(/^\d{4}-\d{2}-\d{2}-/, '').replace(/\.md$/, '');
                    const linkedSpec = specIds.has(`spec:${slug}`) ? `spec:${slug}` : 'TODO';
                    const block = `---\nid: plan:${slug}\nlinkedSpec: ${linkedSpec}\n---\n\n`;
                    fs.writeFileSync(filePath, block + content);
                    fixed++;
                }
                continue;
            }

            if (!frontmatter.id || !frontmatter.id.startsWith('plan:')) {
                issues.push({
                    level: 'warning',
                    file: relPath,
                    message: `frontmatter missing valid id: plan:* (found: ${frontmatter.id || 'none'})`,
                });
                continue;
            }

            if (!frontmatter.linkedSpec || !frontmatter.linkedSpec.startsWith('spec:')) {
                issues.push({
                    level: 'warning',
                    file: relPath,
                    message: `${frontmatter.id} has no linkedSpec / no valid linkedSpec (expected spec:*)`,
                });
            }
        }
    }

    for (const dir of SPEC_DIRS) {
        const abs = path.join(projectRoot, dir);
        if (!fs.existsSync(abs)) continue;

        for (const fname of fs.readdirSync(abs)) {
            if (!fname.endsWith('.md')) continue;

            const filePath = path.join(abs, fname);
            const relPath = path.relative(projectRoot, filePath).replace(/\\/g, '/');
            const content = fs.readFileSync(filePath, 'utf8');
            const { frontmatter } = parseFrontmatter(content);

            if (!frontmatter.id || !frontmatter.id.startsWith('spec:')) continue;

            if (!frontmatter.linkedPlan) {
                issues.push({
                    level: 'info',
                    file: relPath,
                    message: `${frontmatter.id} has no linkedPlan`,
                });
            }
        }
    }

    return { issues, fixed };
}

module.exports = { lintPlans };
