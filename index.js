const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const readline = require('readline/promises');
const http = require('http');

const SELF_VERSION = require(path.join(__dirname, 'package.json')).version;

async function main() {
    // Check for --yes or -y flag
    const args = process.argv.slice(2);
    const isSilent = args.includes('--yes') || args.includes('-y');

    // Find the target directory argument (the first one that isn't a flag)
    const targetDirArg = args.find(arg => !arg.startsWith('-'));

    if (!targetDirArg) {
        console.error('❌ 错误: 请指定目标项目目录。');
        console.error('👉 用法: node index.js <项目路径> [--yes]');
        console.error('💡 示例: node index.js ./MyAwesomeProject');
        process.exit(1);
    }

    const targetDir = path.resolve(targetDirArg);
    console.log(`🚀 Evo-Lite v${SELF_VERSION} — 开始在 ${targetDir} 初始化 Daemonless 记忆大脑...\n`);

    let shouldWash = false;
    const hostAdapterSummary = [];
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
        console.log('🤖 静默模式开启: 使用内置 ONNX 极客配置 (-y)');
        if (hasOldDb) {
            console.log('🔍 检测到旧版记忆库，静默模式下将自动执行跨模型迁移。');
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
    const claudeDir = path.join(targetDir, '.claude');

    [evoLiteDir, cliDir, agentsDir, claudeDir].forEach(dir => {
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }
    });

    // 3. 复制并注入模板文件
    console.log('📄 复制并配置记忆外挂模板文件...');
    const templatesDir = path.join(__dirname, 'templates');
    const activeContextTemplate = fs.readFileSync(path.join(templatesDir, 'active_context.md'), 'utf8');
    const unixWrapperContent = fs.readFileSync(path.join(templatesDir, 'mem'), 'utf8');
    const winWrapperContent = fs.readFileSync(path.join(templatesDir, 'mem.cmd'), 'utf8');
    const agentsAdapterTemplate = fs.readFileSync(path.join(templatesDir, 'AGENTS.md'), 'utf8');
    const claudeAdapterTemplate = fs.readFileSync(path.join(templatesDir, 'CLAUDE.md'), 'utf8');

    const activeContextPath = path.join(evoLiteDir, 'active_context.md');
    const agentsAdapterPath = path.join(targetDir, 'AGENTS.md');
    const claudeAdapterPath = path.join(targetDir, 'CLAUDE.md');

    // 3.0 处理 cli 文件集
    const cliTemplatesDir = path.join(templatesDir, 'cli');
    const cliFiles = fs.existsSync(cliTemplatesDir) ? fs.readdirSync(cliTemplatesDir) : [];

    // 3.1 递归复制函数
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

    let hasUpgraded = false;
    if (fs.existsSync(activeContextPath)) {
        fs.copyFileSync(activeContextPath, activeContextPath + '.bak');
        hasUpgraded = true;
    }

    // 3.2 复制 .agents 目录
    const agentsTemplateDir = path.join(templatesDir, '.agents');
    if (fs.existsSync(agentsTemplateDir)) {
        copyRecursiveSync(agentsTemplateDir, agentsDir);
    }

    const claudeTemplateDir = path.join(templatesDir, '.claude');
    if (fs.existsSync(claudeTemplateDir)) {
        copyRecursiveSync(claudeTemplateDir, claudeDir);
    }

    // 写入 cli 文件
    cliFiles.forEach(file => {
        const content = fs.readFileSync(path.join(cliTemplatesDir, file), 'utf8');
        fs.writeFileSync(path.join(cliDir, file), content);
    });

    // active_context.md 处理：新项目用模板，老项目仅备份并保护内容。
    if (!fs.existsSync(activeContextPath)) {
        fs.writeFileSync(activeContextPath, activeContextTemplate.replace('{{DATE}}', new Date().toISOString().split('T')[0]));
        console.log('✅ 初始化了全新的 active_context.md。');
    } else {
        console.log('🛡️ 发现并保护了已有的 active_context.md 资产。准备进行内容融合注入...');
    }

    if (!fs.existsSync(agentsAdapterPath)) {
        fs.writeFileSync(agentsAdapterPath, agentsAdapterTemplate, 'utf8');
        console.log('✅ 初始化了根目录 AGENTS.md (Codex adapter)。');
        hostAdapterSummary.push('AGENTS.md');
    } else {
        fs.copyFileSync(agentsAdapterPath, agentsAdapterPath + '.bak');
        fs.writeFileSync(agentsAdapterPath, agentsAdapterTemplate, 'utf8');
        hasUpgraded = true;
        console.log('♻️ 更新了根目录 AGENTS.md (旧版本已备份为 .bak)。');
        hostAdapterSummary.push('AGENTS.md');
    }

    if (!fs.existsSync(claudeAdapterPath)) {
        fs.writeFileSync(claudeAdapterPath, claudeAdapterTemplate, 'utf8');
        console.log('✅ 初始化了根目录 CLAUDE.md (Claude Code adapter)。');
        hostAdapterSummary.push('CLAUDE.md');
    } else {
        fs.copyFileSync(claudeAdapterPath, claudeAdapterPath + '.bak');
        fs.writeFileSync(claudeAdapterPath, claudeAdapterTemplate, 'utf8');
        hasUpgraded = true;
        console.log('♻️ 更新了根目录 CLAUDE.md (旧版本已备份为 .bak)。');
        hostAdapterSummary.push('CLAUDE.md');
    }

    // Inject CLI wrappers into .evo-lite to avoid root pollution
    const unixWrapperPath = path.join(evoLiteDir, 'mem');
    const winWrapperPath = path.join(evoLiteDir, 'mem.cmd');
    fs.writeFileSync(unixWrapperPath, unixWrapperContent);
    fs.writeFileSync(winWrapperPath, winWrapperContent);
    try {
        fs.chmodSync(unixWrapperPath, '755');
    } catch (e) { }

    console.log('✅ 核心引擎与体系模板已更新 (旧有模板已保存为 .bak 备份)。');
    if (hostAdapterSummary.length > 0) {
        console.log(`🧭 已同步宿主适配资产: ${hostAdapterSummary.join(', ')}, .claude/commands/`);
        console.log('ℹ️ 这些宿主适配文件属于 Evo-Lite 生成资产；升级模板时允许被覆盖，canonical 语义真源仍然是 .agents/ 与 .evo-lite/。');
        console.log('ℹ️ 后续可使用 `node .evo-lite/cli/memory.js verify` 检查 CLI 与 host adapter 是否和模板保持同步。');
    }

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

    // 4. 安装依赖 (移至前面，以保证后续洗盘脚本可以正常调用模块)
    console.log('📦 正在从 npm 抓取并编译向量数据库及核心依赖 (better-sqlite3, sqlite-vec, @xenova/transformers, tar)...');
    try {
        fs.writeFileSync(path.join(evoLiteDir, 'package.json'), JSON.stringify({
            "name": "evo-lite-workspace",
            "version": SELF_VERSION,
            "private": true,
            "dependencies": {}
        }, null, 2));
        execSync('npm install better-sqlite3 sqlite-vec @xenova/transformers tar', { cwd: evoLiteDir, stdio: 'inherit' });
        console.log('✅ 依赖在线安装成功！');
    } catch (e) {
        console.warn('\n⚠️ 警告: npm 在线安装或外挂 C++ 编译失败！(可能是网络受限或未安装构建工具)');
        console.log('🛡️ 正在启动终极兜底方案：自动解压并注入脱机版预编译依赖包 (fallback-deps.zip)...');

        try {
            const fallbackZip = path.join(__dirname, 'templates', 'fallback-deps.zip');
            if (fs.existsSync(fallbackZip)) {
                execSync(`tar -xf "${fallbackZip}"`, { cwd: evoLiteDir, stdio: 'inherit' });
                console.log('✅ 终极脱机版预编译依赖包注入成功！危机解除！');
            } else {
                console.warn('❌ 无法找到离线备选安装包。请稍后在有网络和编译环境的机器上手动进入 .evo-lite 运行:');
                console.warn('npm install better-sqlite3 sqlite-vec @xenova/transformers tar');
            }
        } catch (fallbackError) {
            console.error('❌ 脱机兜底包注入也失败了:', fallbackError.message);
            console.warn('👉 请稍后手动在 .evo-lite 目录运行:\nnpm install better-sqlite3 sqlite-vec @xenova/transformers tar');
        }
    }

    const offlineModelsDir = path.join(evoLiteDir, 'models');
    if (!fs.existsSync(offlineModelsDir)) {
        fs.mkdirSync(offlineModelsDir, { recursive: true });
    }

    const packagedEmbeddingTar = path.join(__dirname, 'templates', 'embedding-model.tar.gz');
    const runtimeEmbeddingTar = path.join(offlineModelsDir, 'bge-small-zh-v1.5.tar.gz');
    if (fs.existsSync(packagedEmbeddingTar)) {
        fs.copyFileSync(packagedEmbeddingTar, runtimeEmbeddingTar);
    }

    // 4.5 Embedding 模型供给策略 (Jina 优先下载 → BGE 离线兜底)
    let finalEmbedModel = 'Xenova/bge-small-zh-v1.5';
    let finalEmbedDims = 512;

    const jinaCacheDir = path.join(evoLiteDir, '.cache', 'Xenova', 'jina-embeddings-v2-base-zh');
    const bgeCacheDir = path.join(evoLiteDir, '.cache', 'Xenova', 'bge-small-zh-v1.5');
    const jinaAlreadyCached = fs.existsSync(path.join(jinaCacheDir, 'onnx', 'model_quantized.onnx'));
    const bgeAlreadyCached = fs.existsSync(path.join(bgeCacheDir, 'onnx', 'model_quantized.onnx'));

    if (jinaAlreadyCached) {
        // Jina model already exists on disk, skip download
        console.log('✅ 检测到已缓存的推荐 Embedding 模型 (jina-embeddings-v2-base-zh)，跳过下载。');
        finalEmbedModel = 'Xenova/jina-embeddings-v2-base-zh';
        finalEmbedDims = 768;
    } else {
        // Attempt to download Jina model via a temporary probe script
        console.log('🌐 正在尝试下载推荐 Embedding 模型 (jina-embeddings-v2-base-zh, ~110MB)...');
        console.log('   (此步骤需要联网，若网络受限将自动降级至离线 BGE 模型)');
        
        const probePath = path.join(evoLiteDir, '_probe_jina.js');
        const cacheDirEscaped = path.join(evoLiteDir, '.cache').replace(/\\/g, '/');
        fs.writeFileSync(probePath, `
const { pipeline, env } = require('@xenova/transformers');
env.allowLocalModels = true;
env.cacheDir = '${cacheDirEscaped}';
env.remoteHost = 'https://hf-mirror.com';
env.remotePathTemplate = '{model}/resolve/{revision}/';
(async () => {
    try {
        await pipeline('feature-extraction', 'Xenova/jina-embeddings-v2-base-zh', { quantized: true });
        process.exit(0);
    } catch (e) {
        console.error(e.message);
        process.exit(1);
    }
})();
`.trimStart());

        try {
            execSync(`node "${probePath}"`, {
                cwd: evoLiteDir,
                stdio: ['pipe', 'inherit', 'inherit'],
                timeout: 180000 // 3 minutes max
            });
            console.log('✅ 推荐 Embedding 模型 (jina-embeddings-v2-base-zh) 下载成功！');
            finalEmbedModel = 'Xenova/jina-embeddings-v2-base-zh';
            finalEmbedDims = 768;
        } catch (e) {
            console.warn('⚠️ Jina 模型下载失败 (网络受限或超时)。将使用离线 BGE 备用模型。');
            // Fallback: extract offline BGE model cache
            if (!bgeAlreadyCached) {
                const embeddingPkg = runtimeEmbeddingTar;
                if (fs.existsSync(embeddingPkg)) {
                    console.log('🧊 正在解压离线 Embedding 模型缓存 (bge-small-zh-v1.5, ~15MB)...');
                    const cacheRoot = path.join(evoLiteDir, '.cache');
                    if (!fs.existsSync(cacheRoot)) fs.mkdirSync(cacheRoot, { recursive: true });
                    try {
                        execSync(`tar -xzf "${embeddingPkg}"`, { cwd: cacheRoot, stdio: 'inherit' });
                        console.log('✅ 离线 BGE 模型注入成功！无网环境下也可直接使用 remember/recall。');
                    } catch (tarErr) {
                        console.warn('⚠️ 离线模型解压失败，将在首次使用时在线下载:', tarErr.message);
                    }
                }
            } else {
                console.log('✅ 检测到已缓存的 BGE 离线模型，跳过解压。');
            }
        }
        // Cleanup temp probe script
        try { fs.unlinkSync(probePath); } catch (_) {}
    }

    // 4.6 Dynamically patch models.js model config to match actually available model
    const modelsJsFinalPath = path.join(cliDir, 'models.js');
    let modelsJsFinal = fs.readFileSync(modelsJsFinalPath, 'utf8');
    modelsJsFinal = modelsJsFinal
        .replace(/let ACTIVE_MODEL = '.*?';/, `let ACTIVE_MODEL = '${finalEmbedModel}';`)
        .replace(/let ACTIVE_DIMS = \d+;/, `let ACTIVE_DIMS = ${finalEmbedDims};`);
    fs.writeFileSync(modelsJsFinalPath, modelsJsFinal);
    console.log(`📡 运行时引擎已锁定为: ${finalEmbedModel} (${finalEmbedDims}d)`);

    // --- 阶段 D: 跨模型迁移洗盘 ---
    if (shouldWash) {
        console.log('🛁 启动跨模型记忆迁移流程...');
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

                // Step 3: 用新引擎重新嵌入并写入全新 DB
                console.log(`  [3/4] 正在用新 ONNX 引擎重新嵌入 ${exportedData.length} 条记忆 (首次加载模型可能需要下载，请耐心等待)...`);
                execSync(`node "${path.join(cliDir, 'memory.js')}" import "${exportJsonPath}"`, { stdio: 'inherit' });

                // Step 4: 清理导出文件
                console.log('  [4/4] 迁移完毕！正在清理临时导出文件...');
                if (fs.existsSync(exportJsonPath)) fs.unlinkSync(exportJsonPath);
                console.log('✅ 跨模型记忆迁移全部完成！旧记忆已用新引擎重新嵌入。');
            }
        } catch (e) {
            console.error('❌ 跨模型迁移失败:', e.message);
            console.log('💡 你可以稍后手动执行以下步骤来补救:');
            console.log('   1. 检查项目根目录的 evo_memories_exported.json 是否存在');
            console.log('   2. 手动删除 .evo-lite/memory.db');
            console.log('   3. 运行: node .evo-lite/cli/memory.js import evo_memories_exported.json');
        }
    }

    console.log('\n🎉 Evo-Lite 架构已全盘部署完成！');
    console.log('----------------------------------------------------');
    console.log(`👉 下一步:`);
    console.log(`  1. 请确保你已使用 Antigravity 打开了项目目录: ${targetDirArg}`);
    console.log(`  2. 在输入框中输入并发送斜杠命令: /evo`);
    console.log('----------------------------------------------------');
}

main().catch(error => {
    // 优雅捕获用户按下 Ctrl+C 带来的中断报错
    if (error.code === 'ABORT_ERR') {
        console.log('\n🚪 接收到中断信号，初始化已取消。');
        process.exit(0);
    }
    console.error("❌ 初始化过程中发生未卜错误:", error);
    process.exit(1);
});
