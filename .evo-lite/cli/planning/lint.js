'use strict';

const fs = require('fs');
const path = require('path');
const { parseFrontmatter } = require('./parse-markdown');

const PLAN_DIRS = [
    'docs/plans',
    'docs/superpowers/plans',
];

function lintPlans(projectRoot, fix) {
    const issues = [];
    let fixed = 0;

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
                    const block = `---\nid: plan:${slug}\nlinkedSpec: spec:${slug}\n---\n\n`;
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

            if (!frontmatter.linkedSpec) {
                issues.push({
                    level: 'warning',
                    file: relPath,
                    message: `${frontmatter.id} has no linkedSpec`,
                });
            }
        }
    }

    return { issues, fixed };
}

module.exports = { lintPlans };
