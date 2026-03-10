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

    let embedModel = 'Xenova/bge-small-zh-v1.5';
    let rerankModel = 'Xenova/bge-reranker-base';
    let shouldWash = false;

    // 尝试反向提取旧配置以支持无损升级 (仅限于 Transformers.js 路线的配置)
    const oldMemJsPath = path.join(targetDir, '.evo-lite', 'cli', 'memory.js');
    if (fs.existsSync(oldMemJsPath)) {
        try {
            const oldCode = fs.readFileSync(oldMemJsPath, 'utf8');
            const m1 = oldCode.match(/const EMBEDDING_MODEL = '(.*?)';/);
            const m2 = oldCode.match(/const RERANKER_MODEL = '(.*?)';/);
            if (m1 && m1[1].includes('Xenova/')) embedModel = m1[1];
            if (m2 && m2[1].includes('Xenova/')) rerankModel = m2[1];
            console.log('🔄 检测到已有的 Evo-Lite 内存芯片。已成功处理历史配置！');
        } catch (e) { }
    }

    if (isSilent) {
        console.log('🤖 静默模式开启: 使用内置 ONNX 极客配置 (-y)');
    } else {
        const hasOldDb = fs.existsSync(path.join(targetDir, '.evo-lite', 'memory.db'));
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

    // 2. 创建 .evo-lite 结构
    const evoLiteDir = path.join(targetDir, '.evo-lite');
    const cliDir = path.join(evoLiteDir, 'cli');

    if (!fs.existsSync(evoLiteDir)) {
        fs.mkdirSync(evoLiteDir, { recursive: true });
    }
    if (!fs.existsSync(cliDir)) {
        fs.mkdirSync(cliDir, { recursive: true });
    }

    // 2.5 创建 Slash Command 与 规则 目录
    const agentsDir = path.join(targetDir, '.agents');
    const workflowsDir = path.join(agentsDir, 'workflows');
    const rulesDir = path.join(agentsDir, 'rules');
    [agentsDir, workflowsDir, rulesDir].forEach(dir => {
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }
    });

    // 3. 复制并注入模板文件
    console.log('📄 复制并配置记忆外挂模板文件...');
    const templatesDir = path.join(__dirname, 'templates');
    let memoryJsContent = fs.readFileSync(path.join(templatesDir, 'memory.js'), 'utf8');
    const evoWorkflowContent = fs.readFileSync(path.join(templatesDir, 'evo.md'), 'utf8');
    const washWorkflowContent = fs.readFileSync(path.join(templatesDir, 'wash.md'), 'utf8');
    const memWorkflowContent = fs.readFileSync(path.join(templatesDir, 'mem.md'), 'utf8');
    const activeContextTemplate = fs.readFileSync(path.join(templatesDir, 'active_context.md'), 'utf8');
    const unixWrapperContent = fs.readFileSync(path.join(templatesDir, 'mem'), 'utf8');
    const winWrapperContent = fs.readFileSync(path.join(templatesDir, 'mem.cmd'), 'utf8');

    // 将向导中的配置注入到 memory.js 中
    memoryJsContent = memoryJsContent
        .replace(/const EMBEDDING_MODEL = '.*?';/, `const EMBEDDING_MODEL = '${embedModel}';`)
        .replace(/const RERANKER_MODEL = '.*?';/, `const RERANKER_MODEL = '${rerankModel}';`);

    const activeContextPath = path.join(evoLiteDir, 'active_context.md');
    const evoWorkflowPath = path.join(workflowsDir, 'evo.md');
    const washWorkflowPath = path.join(workflowsDir, 'wash.md');
    const memWorkflowPath = path.join(workflowsDir, 'mem.md');

    // 3.1 处理规则文件集
    const rulesTemplatesDir = path.join(templatesDir, 'rules');
    const ruleFiles = fs.existsSync(rulesTemplatesDir) ? fs.readdirSync(rulesTemplatesDir) : [];

    let hasUpgraded = false;
    if (fs.existsSync(activeContextPath)) {
        fs.copyFileSync(activeContextPath, activeContextPath + '.bak');
        hasUpgraded = true;
    }
    if (fs.existsSync(evoWorkflowPath)) {
        fs.copyFileSync(evoWorkflowPath, evoWorkflowPath + '.bak');
        hasUpgraded = true;
    }
    if (fs.existsSync(washWorkflowPath)) {
        fs.copyFileSync(washWorkflowPath, washWorkflowPath + '.bak');
    }
    if (fs.existsSync(memWorkflowPath)) {
        fs.copyFileSync(memWorkflowPath, memWorkflowPath + '.bak');
    }

    // 自动对规则进行备份升级
    ruleFiles.forEach(file => {
        const rulePath = path.join(rulesDir, file);
        if (fs.existsSync(rulePath)) {
            fs.copyFileSync(rulePath, rulePath + '.bak');
            hasUpgraded = true;
        }
    });

    fs.writeFileSync(path.join(cliDir, 'memory.js'), memoryJsContent);
    fs.writeFileSync(evoWorkflowPath, evoWorkflowContent);
    fs.writeFileSync(washWorkflowPath, washWorkflowContent);
    fs.writeFileSync(memWorkflowPath, memWorkflowContent);

    // 写入规则文件
    ruleFiles.forEach(file => {
        const ruleContent = fs.readFileSync(path.join(rulesTemplatesDir, file), 'utf8');
        fs.writeFileSync(path.join(rulesDir, file), ruleContent);
    });

    // active_context.md 处理：新项目用模板，老项目仅备份并保护内容。
    if (!fs.existsSync(activeContextPath)) {
        fs.writeFileSync(activeContextPath, activeContextTemplate.replace('{{DATE}}', new Date().toISOString().split('T')[0]));
        console.log('✅ 初始化了全新的 active_context.md。');
    } else {
        console.log('🛡️ 发现并保护了已有的 active_context.md 资产。准备进行内容融合注入...');
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

    // 4. 注入热更新警告与融合指令 (Fusion Warning)
    if (hasUpgraded) {
        try {
            let contextContent = fs.readFileSync(activeContextPath, 'utf8');
            const warningMsg = `\n> ⚠️ **框架已热更新**: 检测到核心引擎升级，原有的历史进度（如 \`active_context.md\`）已备份至 \`.bak\`。**请 AI 助手立即阅读 \`active_context.md.bak\` 以核对并恢复最新的开发进度。** 在完成手动融合与清理后，请删除此警告并清理 \`.bak\` 文件。\n`;

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
    console.log('📦 正在从 npm 抓取并编译向量数据库及核心依赖 (better-sqlite3, sqlite-vec, @xenova/transformers)...');
    try {
        fs.writeFileSync(path.join(evoLiteDir, 'package.json'), JSON.stringify({
            "name": "evo-lite-workspace",
            "version": SELF_VERSION,
            "private": true,
            "dependencies": {}
        }, null, 2));
        execSync('npm install better-sqlite3 sqlite-vec @xenova/transformers', { cwd: evoLiteDir, stdio: 'inherit' });
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
                console.warn('npm install better-sqlite3 sqlite-vec axios');
            }
        } catch (fallbackError) {
            console.error('❌ 脱机兜底包注入也失败了:', fallbackError.message);
            console.warn('👉 请稍后手动在 .evo-lite 目录运行:\nnpm install better-sqlite3 sqlite-vec axios');
        }
    }

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
