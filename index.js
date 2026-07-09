const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const readline = require('readline/promises');
const http = require('http');
const { Command } = require('commander');
const { buildManagedTemplateEntries } = require(path.join(__dirname, 'templates', 'cli', 'template-manifest'));
const { installPostCommitHook, diffInstalledHook } = require(path.join(__dirname, 'templates', 'cli', 'hooks'));

const SELF_VERSION = require(path.join(__dirname, 'package.json')).version;
const INITIAL_COMMIT_MESSAGE = 'chore: initialize Evo-Lite workspace';
const MIN_NODE_MAJOR = 20;

// Pure, testable Node-version preflight. The runtime depends on commander@14
// (Node >=20) and a native better-sqlite3 build; scaffolding on an older Node
// leaves a half-initialized workspace, so fail before writing anything.
function assertNodeVersion(versionString = process.versions.node) {
    const major = parseInt(String(versionString).split('.')[0], 10);
    if (!Number.isFinite(major) || major < MIN_NODE_MAJOR) {
        return {
            ok: false,
            message: `Evo-Lite requires Node.js >= ${MIN_NODE_MAJOR} (found ${versionString}).`,
        };
    }
    return { ok: true, message: '' };
}

// Exact-pinned runtime dependencies so a given create-evo-lite version always
// installs the same runtime (P1: reproducible deps). Bump these deliberately;
// the release-gate CI proves a pinned set installs across the supported matrix.
const RUNTIME_DEPENDENCIES = {
    'better-sqlite3': '12.11.1',
    'tar': '7.5.16',
    'commander': '15.0.0',
    '@modelcontextprotocol/sdk': '1.29.0',
};

function writeRuntimeManifest(evoLiteDir) {
    const runtimeTemplateDir = path.join(__dirname, 'templates', 'runtime');
    fs.copyFileSync(
        path.join(runtimeTemplateDir, 'package.json'),
        path.join(evoLiteDir, 'package.json'));
    fs.copyFileSync(
        path.join(runtimeTemplateDir, 'package-lock.json'),
        path.join(evoLiteDir, 'package-lock.json'));
    // The shipped runtime manifest is version-pinned (decoupled from the product
    // version to keep the lockfile stable), so the actual product version travels
    // via a separate artifact the runtime reads for MCP version reporting.
    fs.writeFileSync(
        path.join(evoLiteDir, 'evo-lite-version.json'),
        JSON.stringify({ version: SELF_VERSION }, null, 2) + '\n');
}

// Fail-closed runtime dependency install. Returns an explicit readiness verdict
// instead of swallowing failures: a missing toolchain, offline registry, or
// --skip-install leaves state 'runtime-not-ready' so the caller can refuse to
// declare success and exit non-zero. `exec` is injectable for testing.
function installRuntimeDependencies(evoLiteDir, options = {}) {
    const exec = options.exec || ((cmd, opts) => execSync(cmd, opts));
    // Always restore the runtime manifest + lockfile first — even when the install is
    // skipped — so the documented `cd .evo-lite && npm ci` recovery actually has the
    // files it needs. (`writeManifest: false` is a test-only escape hatch.)
    if (options.writeManifest !== false) {
        writeRuntimeManifest(evoLiteDir);
    }
    if (options.skipInstall) {
        return {
            ok: false,
            state: 'runtime-not-ready',
            skipped: true,
            message: '依赖安装已按 --skip-install/--offline 跳过。',
        };
    }
    try {
        // npm ci restores the exact shipped lockfile — deterministic, no resolution.
        exec('npm ci', { cwd: evoLiteDir, stdio: 'inherit' });
        return { ok: true, state: 'runtime-ready', message: '依赖在线安装成功！' };
    } catch (e) {
        return {
            ok: false,
            state: 'runtime-not-ready',
            error: getExecErrorText(e),
            message: 'npm 在线安装或外挂 C++ 编译失败！(可能是网络受限或未安装构建工具)',
        };
    }
}

function buildProgram() {
    return new Command()
        .name('create-evo-lite')
        .description('Scaffold Evo-Lite into a target project directory.')
        .version(SELF_VERSION)
        .argument('[project-path]', 'Target project path')
        .option('-y, --yes', 'Use default initialization configuration')
        .option('--no-git', 'Skip git repository initialization')
        .option('--no-initial-commit', 'Skip automatic baseline scaffold commit')
        .option('--skip-install', 'Scaffold only; skip runtime dependency install (reports runtime-not-ready)')
        .option('--offline', 'Alias for --skip-install: no network install, reports runtime-not-ready')
        .showHelpAfterError();
}

function getExecErrorText(error) {
    if (!error) {
        return '';
    }

    const parts = [];
    if (typeof error.message === 'string') {
        parts.push(error.message);
    }
    if (typeof error.stderr === 'string') {
        parts.push(error.stderr);
    } else if (Buffer.isBuffer(error.stderr)) {
        parts.push(error.stderr.toString('utf8'));
    }
    if (typeof error.stdout === 'string') {
        parts.push(error.stdout);
    } else if (Buffer.isBuffer(error.stdout)) {
        parts.push(error.stdout.toString('utf8'));
    }
    return parts.join('\n');
}

function isGitCommandMissing(error) {
    return /not recognized as an internal or external command|enoent|spawn git/i.test(getExecErrorText(error));
}

function isMissingGitWorkspace(error) {
    return /not a git repository/i.test(getExecErrorText(error));
}

function isGitIdentityMissing(error) {
    return /author identity unknown|unable to auto-detect email address|please tell me who you are/i.test(getExecErrorText(error));
}

function hasEvoLiteGitignoreRules(content = '') {
    return content.includes('.evo-lite/*')
        && content.includes('!.evo-lite/active_context.md')
        && content.includes('!.evo-lite/cli/**');
}

function extractEvoLiteGitignoreBlock(templateContent) {
    const normalized = typeof templateContent === 'string' ? templateContent.trim() : '';
    const marker = '# Evo-Lite runtime';
    const markerIndex = normalized.indexOf(marker);

    if (!normalized) {
        return '';
    }

    return markerIndex === -1 ? normalized : normalized.slice(markerIndex).trim();
}

function ensureProjectGitignore(targetDir, templateContent) {
    const gitignorePath = path.join(targetDir, '.gitignore');
    const normalizedTemplate = typeof templateContent === 'string' ? templateContent.trim() : '';
    const evoLiteBlock = extractEvoLiteGitignoreBlock(templateContent);

    if (!normalizedTemplate) {
        return { status: 'missing-template' };
    }

    if (!fs.existsSync(gitignorePath)) {
        fs.writeFileSync(gitignorePath, `${normalizedTemplate}\n`, 'utf8');
        console.log('✅ 已初始化项目 .gitignore，并加入 Evo-Lite 运行时忽略规则。');
        return { status: 'created' };
    }

    const currentContent = fs.readFileSync(gitignorePath, 'utf8');
    if (hasEvoLiteGitignoreRules(currentContent)) {
        return { status: 'existing' };
    }

    const separator = currentContent.endsWith('\n') ? '' : '\n';
    fs.writeFileSync(gitignorePath, `${currentContent}${separator}\n${evoLiteBlock}\n`, 'utf8');
    console.log('✅ 已向现有 .gitignore 补齐 Evo-Lite 运行时忽略规则。');
    return { status: 'updated' };
}

function getInitialCommitHint() {
    return `git add . && git commit -m "${INITIAL_COMMIT_MESSAGE}"`;
}

function ensureGitWorkspace(targetDir, options = {}) {
    if (options.git === false) {
        console.log('ℹ️ Git 初始化已按配置跳过 (--no-git)。Evo-Lite 将以 No-Git 模式继续运行。');
        return { status: 'skipped' };
    }

    try {
        execSync('git rev-parse --is-inside-work-tree', {
            cwd: targetDir,
            stdio: ['ignore', 'pipe', 'pipe'],
        });
        console.log('✅ Git 工作区已存在，保留当前仓库状态。');
        return { status: 'existing' };
    } catch (error) {
        if (isGitCommandMissing(error)) {
            console.warn('⚠️ 未检测到 Git 可执行文件，无法自动初始化仓库。Evo-Lite 将暂时以 No-Git 模式继续。');
            return { status: 'missing-git' };
        }
        if (!isMissingGitWorkspace(error)) {
            console.warn(`⚠️ Git 工作区探测失败: ${getExecErrorText(error).trim()}`);
            return { status: 'probe-failed' };
        }
    }

    try {
        execSync('git init', {
            cwd: targetDir,
            stdio: 'ignore',
        });
        console.log('✅ 已为目标项目初始化 Git 仓库。');
        return { status: 'initialized' };
    } catch (error) {
        if (isGitCommandMissing(error)) {
            console.warn('⚠️ 未检测到 Git 可执行文件，无法自动初始化仓库。Evo-Lite 将暂时以 No-Git 模式继续。');
            return { status: 'missing-git' };
        }
        console.warn(`⚠️ Git 自动初始化失败: ${getExecErrorText(error).trim()}`);
        return { status: 'init-failed' };
    }
}

function createInitialCommit(targetDir, options = {}) {
    if (options.initialCommit === false) {
        console.log('ℹ️ 初始化基线提交已按配置跳过 (--no-initial-commit)。');
        console.log(`💡 如需手动提交当前脚手架状态，可执行: ${getInitialCommitHint()}`);
        return { status: 'skipped' };
    }

    if (options.gitStatus !== 'initialized') {
        return { status: 'not-applicable' };
    }

    if (options.isFreshTarget !== true) {
        console.log('ℹ️ 检测到目标目录初始化前已含内容，未自动创建基线提交，以避免把既有文件混入脚手架首个提交。');
        console.log(`💡 如需手动提交当前脚手架状态，可执行: ${getInitialCommitHint()}`);
        return { status: 'nonfresh-target' };
    }

    try {
        const statusOutput = execSync('git status --short', {
            cwd: targetDir,
            stdio: ['ignore', 'pipe', 'pipe'],
        }).toString('utf8').trim();

        if (!statusOutput) {
            console.log('ℹ️ Git 工作区当前无待提交内容，跳过自动基线提交。');
            return { status: 'clean' };
        }
    } catch (error) {
        console.warn(`⚠️ 无法确认初始化工作区状态，已跳过自动基线提交: ${getExecErrorText(error).trim()}`);
        console.log(`💡 如需手动提交当前脚手架状态，可执行: ${getInitialCommitHint()}`);
        return { status: 'status-check-failed' };
    }

    try {
        execSync('git add --all', {
            cwd: targetDir,
            stdio: 'ignore',
        });
        execSync(`git commit -m "${INITIAL_COMMIT_MESSAGE}"`, {
            cwd: targetDir,
            stdio: ['ignore', 'pipe', 'pipe'],
        });
        console.log(`✅ 已创建 Evo-Lite 初始化基线提交 (${INITIAL_COMMIT_MESSAGE})。`);
        return { status: 'committed' };
    } catch (error) {
        if (isGitIdentityMissing(error)) {
            console.warn('⚠️ Git 用户身份未配置，无法自动创建初始化基线提交。');
            console.log('💡 请先配置 `git config user.name` 和 `git config user.email`，再手动提交当前脚手架状态。');
            console.log(`💡 建议首个提交: ${getInitialCommitHint()}`);
            return { status: 'identity-missing' };
        }
        console.warn(`⚠️ 自动创建初始化基线提交失败: ${getExecErrorText(error).trim()}`);
        console.log(`💡 建议首个提交: ${getInitialCommitHint()}`);
        return { status: 'commit-failed' };
    }
}

async function runInit(targetDirArg, options = {}) {
    const isSilent = options.yes === true;

    if (!targetDirArg) {
        console.error('❌ 错误: 请指定目标项目目录。');
        console.error('👉 用法: node index.js <项目路径> [--yes]');
        console.error('💡 示例: node index.js ./MyAwesomeProject');
        process.exit(1);
    }

    const targetDir = path.resolve(targetDirArg);
    const preExistingEntries = fs.existsSync(targetDir) ? fs.readdirSync(targetDir) : [];
    const isFreshTarget = preExistingEntries.length === 0;
    console.log(`🚀 Evo-Lite v${SELF_VERSION} — 开始在 ${targetDir} 初始化 Daemonless 记忆大脑...\n`);

    let shouldWash = false;
    const legacyContextPath = path.join(targetDir, '.evo-lite', 'active_context.md');
    const legacyCliPath = path.join(targetDir, '.evo-lite', 'cli', 'memory.js');
    const modernModelsPath = path.join(targetDir, '.evo-lite', 'cli', 'models.js');
    const modernDbCliPath = path.join(targetDir, '.evo-lite', 'cli', 'db.js');
    const legacyTemplatesRulesDir = path.join(targetDir, 'templates', 'rules');
    const hasLegacyCli = fs.existsSync(legacyCliPath) && (!fs.existsSync(modernModelsPath) || !fs.existsSync(modernDbCliPath));
    const hasLegacyTemplatesRules = fs.existsSync(legacyTemplatesRulesDir);
    const hasLegacyContext = fs.existsSync(legacyContextPath)
        && !fs.readFileSync(legacyContextPath, 'utf8').includes('<!-- BEGIN_META -->');

    if (hasLegacyCli || hasLegacyTemplatesRules || hasLegacyContext) {
        console.error('❌ create-evo-lite@2.x 不支持在 npm 发布的 1.4.9 旧项目上原地升级。');
        console.error('ℹ️ 2.x 之后的运行时结构已发生破坏性变化，包括 memory schema、active_context 锚点格式与宿主适配资产布局。');
        console.error('👉 请新建一个全新目录重新初始化 2.x 项目，不要覆盖旧项目目录。');
        console.error('👉 如需保留旧数据，请继续使用 1.4.9 维护旧项目，或先手工导出后再迁移到新目录。');
        process.exit(1);
    }

    const hasOldDb = fs.existsSync(path.join(targetDir, '.evo-lite', 'memory.db'));

    if (isSilent) {
        console.log('🤖 静默模式开启: 使用默认初始化配置 (-y)');
        if (hasOldDb) {
            console.log('🔍 检测到旧版记忆库，静默模式下将自动执行旧记忆重建。');
            shouldWash = true;
        }
    } else {
        if (hasOldDb) {
            const rl = readline.createInterface({
                input: process.stdin,
                output: process.stdout
            });

            console.log('================= 配置向导 (Evo-Link) =================');
            const washInput = await rl.question(`检测到旧版记忆库。是否执行脱机洗盘，自动提取并重构旧数据格式至全新规范？(y/N) [N]: `);
            if (washInput.trim().toLowerCase() === 'y') {
                shouldWash = true;
            }
            console.log('======================================================\n');
            rl.close();
        }
    }

    // 1. 创建目标目录 (如果不存在)
    if (!fs.existsSync(targetDir)) {
        console.log(`📁 创建项目目录: ${targetDir}`);
        fs.mkdirSync(targetDir, { recursive: true });
    }

    // 2. 创建 .evo-lite 和 .agents 结构
    const evoLiteDir = path.join(targetDir, '.evo-lite');
    const cliDir = path.join(evoLiteDir, 'cli');
    const agentsDir = path.join(targetDir, '.agents');

    [evoLiteDir, cliDir, agentsDir].forEach(dir => {
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }
    });

    // 3. 复制并注入模板文件
    console.log('📄 复制并配置记忆外挂模板文件...');
    const templatesDir = path.join(__dirname, 'templates');
    const activeContextTemplate = fs.readFileSync(path.join(templatesDir, 'active_context.md'), 'utf8');
    // Source asset is named `gitignore` (no dot): npm pack strips files named
    // `.gitignore` from the published tarball, so a dotted template name ships as
    // a missing file and breaks scaffolding. The initializer still writes the
    // target project's `.gitignore` from this content.
    const gitignoreTemplate = fs.readFileSync(path.join(templatesDir, 'gitignore'), 'utf8');
    const unixWrapperContent = fs.readFileSync(path.join(templatesDir, 'mem'), 'utf8');
    const winWrapperContent = fs.readFileSync(path.join(templatesDir, 'mem.cmd'), 'utf8');

    const activeContextPath = path.join(evoLiteDir, 'active_context.md');

    // 3.0 处理 cli 文件集
    const cliTemplatesDir = path.join(templatesDir, 'cli');

    // 3.1 递归复制函数
    let hasUpgraded = false;
    function copyRecursiveSync(src, dest) {
        const exists = fs.existsSync(src);
        const stats = exists && fs.statSync(src);
        const isDirectory = exists && stats.isDirectory();
        if (isDirectory) {
            if (!fs.existsSync(dest)) {
                fs.mkdirSync(dest, { recursive: true });
            }
            fs.readdirSync(src).forEach(childItemName => {
                copyRecursiveSync(path.join(src, childItemName),
                                  path.join(dest, childItemName));
            });
        } else {
            // 在复制前进行备份
            if (fs.existsSync(dest)) {
                fs.copyFileSync(dest, dest + '.bak');
                hasUpgraded = true; // 标记发生了升级
            }
            fs.copyFileSync(src, dest);
        }
    }

    function copyManagedTemplateAssets(entries) {
        for (const entry of entries) {
            const destinationExists = fs.existsSync(entry.activeFile);
            if (entry.scope === 'copy-on-init' && destinationExists) {
                if (entry.label === '.github/workflows/evo-lite-archive.yml') {
                    console.log('ℹ️ 检测到 .github/workflows/evo-lite-archive.yml 已存在，未覆盖；如需升级请手工对比 templates/.github/workflows/evo-lite-archive.yml。');
                }
                continue;
            }
            fs.mkdirSync(path.dirname(entry.activeFile), { recursive: true });
            copyRecursiveSync(entry.templateFile, entry.activeFile);
            if (entry.scope === 'copy-on-init' && entry.label === '.github/workflows/evo-lite-archive.yml') {
                console.log('🤖 已注入 P5 团队模式 workflow: .github/workflows/evo-lite-archive.yml (PR 合并后自动归档；可在 GitHub Settings 中按需启用)。');
            }
        }
    }

    if (fs.existsSync(activeContextPath)) {
        fs.copyFileSync(activeContextPath, activeContextPath + '.bak');
        hasUpgraded = true;
    }

    // 3.2 复制 .agents/rules，并通过 managed manifest 同步其余治理资产
    const agentRulesTemplateDir = path.join(templatesDir, '.agents', 'rules');
    if (fs.existsSync(agentRulesTemplateDir)) {
        copyRecursiveSync(agentRulesTemplateDir, path.join(agentsDir, 'rules'));
    }

    copyManagedTemplateAssets(
        buildManagedTemplateEntries({
            workspaceRoot: targetDir,
            activeCliDir: cliDir,
            templateRootPath: templatesDir,
            templateCliPath: cliTemplatesDir,
            scopes: ['sync-always', 'copy-on-init'],
        }).filter(entry => !['core-cli', 'root-host-adapters'].includes(entry.family))
    );

    // 写入 cli 文件（递归支持 planning/ architecture/ 等子目录）
    if (fs.existsSync(cliTemplatesDir)) {
        copyRecursiveSync(cliTemplatesDir, cliDir);
    }

    // Hive feedback outbox：子巢上报 evo-lite 摩擦的协议文件（内容归子巢，只在缺失时创建）
    const hiveFeedbackPath = path.join(evoLiteDir, 'hive', 'feedback.md');
    if (!fs.existsSync(hiveFeedbackPath)) {
        fs.mkdirSync(path.dirname(hiveFeedbackPath), { recursive: true });
        fs.writeFileSync(hiveFeedbackPath, require(path.join(cliTemplatesDir, 'hive', 'feedback.js')).FEEDBACK_TEMPLATE);
    }

    // active_context.md 处理：新项目用模板，老项目仅备份并保护内容。
    if (!fs.existsSync(activeContextPath)) {
        fs.writeFileSync(activeContextPath, activeContextTemplate.replace('{{DATE}}', new Date().toISOString().split('T')[0]));
        console.log('✅ 初始化了全新的 active_context.md。');
    } else {
        console.log('🛡️ 发现并保护了已有的 active_context.md 资产。准备进行内容融合注入...');
    }

    ensureProjectGitignore(targetDir, gitignoreTemplate);

    // Inject CLI wrappers into .evo-lite to avoid root pollution
    const unixWrapperPath = path.join(evoLiteDir, 'mem');
    const winWrapperPath = path.join(evoLiteDir, 'mem.cmd');
    fs.writeFileSync(unixWrapperPath, unixWrapperContent);
    fs.writeFileSync(winWrapperPath, winWrapperContent);
    try {
        fs.chmodSync(unixWrapperPath, '755');
    } catch (e) { }

    console.log('`✅ 核心引擎与体系模板已更新 (旧有模板已保存为 .bak 备份)。`');

    // 4. 注入热更新警告与融合指令 (Fusion Warning)
    if (hasUpgraded) {
        try {
            let contextContent = fs.readFileSync(activeContextPath, 'utf8');
            const warningMsg = `\n> ⚠️ **框架已热更新**: 检测到核心引擎升级，原有的历史进度已备份至 \`active_context.md.bak\`。**请 AI 助手立即执行以下两步：① 读取 \`active_context.md.bak\` 提取历史进度；② 按新四锚点格式（BEGIN/END_META、FOCUS、BACKLOG、TRAJECTORY）重写本文件，BACKLOG 保留 ≤5 条未完成任务，TRAJECTORY 保留 ≤3 条最近轨迹。** 完成后删除此警告并清理 \`.bak\` 文件。\n`;

            if (!contextContent.includes('⚠️ **框架已热更新**')) {
                // 尝试插在标题之后，如果没有标题则插在最前面
                const firstHeaderRegex = /^(# .+\n*)/;
                if (firstHeaderRegex.test(contextContent)) {
                    contextContent = contextContent.replace(firstHeaderRegex, `$1${warningMsg}`);
                } else {
                    contextContent = warningMsg + contextContent;
                }
                fs.writeFileSync(activeContextPath, contextContent);
                console.log('🤖 已在 active_context.md 注入内容融合处理向导！');
            }
        } catch (e) { }
    }

    // 4.5 补齐 Git 前提，避免首次闭环就落入 No-Git 模式。
    const gitWorkspace = ensureGitWorkspace(targetDir, options);
    installPostCommitHook(targetDir);

    // 5. 安装依赖 (移至前面，以保证后续洗盘脚本可以正常调用模块)
    console.log('📦 正在从 npm 抓取并编译本地记忆引擎依赖 (better-sqlite3, tar, commander, @modelcontextprotocol/sdk)...');
    const installResult = installRuntimeDependencies(evoLiteDir, {
        skipInstall: !!(options.skipInstall || options.offline),
    });
    if (installResult.ok) {
        console.log(`✅ ${installResult.message}`);
    } else {
        console.warn(`\n⚠️ 警告: ${installResult.message}`);
        console.warn(`👉 请稍后手动在 .evo-lite 目录运行:\nnpm ci`);
    }
    console.log('📡 运行时引擎已锁定为: sqlite-fts5-trigram');

    // --- 阶段 D: 旧记忆重建洗盘 ---
    if (shouldWash) {
        console.log('🛁 启动旧记忆重建流程...');
        try {
            const dbPath = path.join(evoLiteDir, 'memory.db');
            const exportJsonPath = path.join(targetDir, 'evo_memories_exported.json');

            // Step 1: 导出旧记忆纯文本 (绕过指纹校验)
            console.log('  [1/4] 正在导出旧记忆碎片...');
            execSync(`node "${path.join(cliDir, 'memory.js')}" export "${exportJsonPath}"`, { stdio: 'inherit' });

            // Step 2: 校验导出文件是否有真实内容
            const exportedData = JSON.parse(fs.readFileSync(exportJsonPath, 'utf8'));
            if (!Array.isArray(exportedData) || exportedData.length === 0) {
                console.log('  ⚠️ 旧库为空，跳过迁移。');
            } else {
                console.log(`  [2/4] 导出成功 (${exportedData.length} 条)。正在销毁旧向量数据库...`);
                // 删除旧 DB 及其 WAL/SHM 附属文件
                [dbPath, dbPath + '-wal', dbPath + '-shm'].forEach(f => {
                    if (fs.existsSync(f)) fs.unlinkSync(f);
                });

                // Step 3: 用当前本地索引引擎重新导入并写入全新 DB
                console.log(`  [3/4] 正在用当前本地索引引擎重新导入 ${exportedData.length} 条记忆...`);
                execSync(`node "${path.join(cliDir, 'memory.js')}" import "${exportJsonPath}"`, { stdio: 'inherit' });

                // Step 4: 清理导出文件
                console.log('  [4/4] 迁移完毕！正在清理临时导出文件...');
                if (fs.existsSync(exportJsonPath)) fs.unlinkSync(exportJsonPath);
                console.log('✅ 旧记忆重建全部完成！历史记忆已按当前本地索引格式重新导入。');
            }
        } catch (e) {
            console.error('❌ 旧记忆重建失败:', e.message);
            console.log('💡 你可以稍后手动执行以下步骤来补救:');
            console.log('   1. 检查项目根目录的 evo_memories_exported.json 是否存在');
            console.log('   2. 手动删除 .evo-lite/memory.db');
            console.log('   3. 运行: node .evo-lite/cli/memory.js import evo_memories_exported.json');
        }
    }

    createInitialCommit(targetDir, {
        gitStatus: gitWorkspace.status,
        initialCommit: options.initialCommit,
        isFreshTarget,
    });

    if (!installResult.ok) {
        console.error('\n⚠️ Evo-Lite 脚手架已创建，但运行时依赖未就绪 (scaffold-created / runtime-not-ready)。');
        console.error('   在 .evo-lite 目录完成依赖安装前，bootstrap / 数据库 / archive / MCP 将不可用。');
        console.error(`   修复: cd .evo-lite && npm ci`);
        console.error('----------------------------------------------------');
        process.exitCode = 1;
        return;
    }

    console.log('\n🎉 Evo-Lite 架构已全盘部署完成！');
    console.log('----------------------------------------------------');
    console.log(`👉 下一步:`);
    console.log(`  1. 请确保你已使用 Antigravity 打开了项目目录: ${targetDirArg}`);
    console.log('  2. 先运行 `.evo-lite\\mem.cmd bootstrap` (Windows) 或 `./.evo-lite/mem bootstrap` (Unix) 获取压缩接管摘要。');
    console.log('  3. 如果你使用的是支持工作流语义的 Agent，再触发 `/evo` 或直接继续开发。');
    console.log('----------------------------------------------------');
}


async function main(argv = process.argv) {
    const nodeCheck = assertNodeVersion();
    if (!nodeCheck.ok) {
        console.error(`❌ ${nodeCheck.message}`);
        console.error('👉 请升级 Node.js 至 20 或更高版本后重试。');
        process.exit(1);
    }

    const program = buildProgram();
    program.parse(argv);
    const options = program.opts();
    const [targetDirArg] = program.processedArgs;
    await runInit(targetDirArg, options);
}

function handleCliError(error) {
    // 优雅捕获用户按下 Ctrl+C 带来的中断报错
    if (error.code === 'ABORT_ERR') {
        console.log('\n🚪 接收到中断信号，初始化已取消。');
        process.exit(0);
    }
    console.error("❌ 初始化过程中发生未卜错误:", error);
    process.exit(1);
}

module.exports = {
    assertNodeVersion,
    installRuntimeDependencies,
    writeRuntimeManifest,
    RUNTIME_DEPENDENCIES,
    SELF_VERSION,
    buildProgram,
    handleCliError,
    installPostCommitHook,
    diffInstalledHook,
    main,
    runInit,
};

if (path.resolve(process.argv[1] || '') === path.resolve(__filename)) {
    main().catch(handleCliError);
}
