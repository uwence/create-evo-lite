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

    let embedUrl = 'http://localhost:12342/v1/embeddings';
    let embedModel = 'jina-embeddings-v2-base-zh';
    let rerankUrl = 'http://localhost:12342/v1/rerank';
    let rerankModel = 'text-embedding-bge-reranker-base';
    let shouldWash = false;

    // 尝试反向提取旧配置以支持无损升级
    const oldMemJsPath = path.join(targetDir, '.evo-lite', 'cli', 'memory.js');
    if (fs.existsSync(oldMemJsPath)) {
        try {
            const oldCode = fs.readFileSync(oldMemJsPath, 'utf8');
            const m1 = oldCode.match(/const LM_STUDIO_URL = '(.*?)';/);
            const m2 = oldCode.match(/const MODEL_NAME = '(.*?)';/);
            const m3 = oldCode.match(/const LM_STUDIO_RERANK_URL = '(.*?)';/);
            const m4 = oldCode.match(/const RERANKER_MODEL = '(.*?)';/);
            if (m1) embedUrl = m1[1];
            if (m2) embedModel = m2[1];
            if (m3) rerankUrl = m3[1];
            if (m4) rerankModel = m4[1];
            console.log('🔄 检测到已有的 Evo-Lite 内存芯片。已成功提取历史配置，准备进行无损热升级！');
        } catch (e) { }
    }

    if (isSilent) {
        console.log('🤖 静默模式开启: 使用默认 LM Studio 配置 (-y)');
    } else {
        // --- 交互式向导 ---
        const rl = readline.createInterface({
            input: process.stdin,
            output: process.stdout
        });

        console.log('================= 配置向导 (Evo-Link) =================');
        console.log('直接按回车可使用默认的 LM Studio 本地极客配置。');
        console.log('\n--- 阶段 A: 初步搜索 (Embedding) ---');
        embedUrl = await rl.question(`1. API URL [${embedUrl}]: `) || embedUrl;
        embedModel = await rl.question(`2. 模型名称 [${embedModel}]: `) || embedModel;

        console.log('\n--- 阶段 B: 语义重排 (Reranker) - 精度保证 ---');
        rerankUrl = await rl.question(`3. API URL [${rerankUrl}]: `) || rerankUrl;
        rerankModel = await rl.question(`4. 模型名称 [${rerankModel}]: `) || rerankModel;

        if (fs.existsSync(path.join(targetDir, '.evo-lite', 'memory.db'))) {
            console.log('\n--- 阶段 C: 历史债务清洗 (Data Washing) ---');
            const washInput = await rl.question(`5. 检测到旧记忆库。是否执行脱机洗盘以提取并自动重构旧数据格式至全新规范？(y/N) [N]: `);
            if (washInput.trim().toLowerCase() === 'y') {
                shouldWash = true;
            }
        }
        console.log('\n======================================================\n');
        rl.close();
    }

    // 探活测试
    console.log('📡 正在探测 Embedding API 连通性...');
    try {
        await new Promise((resolve, reject) => {
            const req = http.request(embedUrl.replace('/embeddings', '/models'), {
                method: 'GET',
                timeout: 2000
            }, (res) => {
                if (res.statusCode === 200 || res.statusCode === 404 || res.statusCode === 405) {
                    // 只要能通，不管具体路由对不对都算连上了宿主
                    console.log('✅ Endpoint 连通测试通过！');
                    resolve();
                    req.destroy();
                } else {
                    resolve(); // 忽略内部 HTTP 错误
                    req.destroy();
                }
            });
            req.on('error', (e) => {
                console.warn(`\n⚠️ 警告: 无法连接到 ${embedUrl}。`);
                console.warn('⚠️ 请确保你的 LM Studio 已经启动了 Local Server 开发并加载了对应的模型！\n');
                resolve();
            });
            req.on('timeout', () => {
                req.destroy();
                console.warn(`\n⚠️ 警告: 连接 ${embedUrl} 超时。请确保服务已启动。\n`);
                resolve();
            });
            req.end();
        });
    } catch (e) { }

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

    // 2.5 创建 Slash Command 目录
    const workflowsDir = path.join(targetDir, '.agents', 'workflows');
    if (!fs.existsSync(workflowsDir)) {
        fs.mkdirSync(workflowsDir, { recursive: true });
    }

    // 3. 复制并注入模板文件
    console.log('📄 复制并配置记忆外挂模板文件...');
    const templatesDir = path.join(__dirname, 'templates');
    let memoryJsContent = fs.readFileSync(path.join(templatesDir, 'memory.js'), 'utf8');
    const activateContent = fs.readFileSync(path.join(templatesDir, 'ACTIVATE_EVO_LITE.md'), 'utf8');
    const evoWorkflowContent = fs.readFileSync(path.join(templatesDir, 'evo.md'), 'utf8');
    const washWorkflowContent = fs.readFileSync(path.join(templatesDir, 'wash.md'), 'utf8');
    const unixWrapperContent = fs.readFileSync(path.join(templatesDir, 'evo'), 'utf8');
    const winWrapperContent = fs.readFileSync(path.join(templatesDir, 'evo.cmd'), 'utf8');

    // 将向导中的配置注入到 memory.js 中
    memoryJsContent = memoryJsContent
        .replace(/const LM_STUDIO_URL = '.*?';/, `const LM_STUDIO_URL = '${embedUrl}';`)
        .replace(/const LM_STUDIO_RERANK_URL = '.*?';/, `const LM_STUDIO_RERANK_URL = '${rerankUrl}';`)
        .replace(/const MODEL_NAME = '.*?';/, `const MODEL_NAME = '${embedModel}';`)
        .replace(/const RERANKER_MODEL = '.*?';/, `const RERANKER_MODEL = '${rerankModel}';`);

    const activatePath = path.join(evoLiteDir, 'ACTIVATE_EVO_LITE.md');
    const evoWorkflowPath = path.join(workflowsDir, 'evo.md');
    const washWorkflowPath = path.join(workflowsDir, 'wash.md');

    let hasUpgraded = false;
    if (fs.existsSync(activatePath)) {
        fs.copyFileSync(activatePath, activatePath + '.bak');
        hasUpgraded = true;
    }
    if (fs.existsSync(evoWorkflowPath)) {
        fs.copyFileSync(evoWorkflowPath, evoWorkflowPath + '.bak');
        hasUpgraded = true;
    }
    if (fs.existsSync(washWorkflowPath)) {
        fs.copyFileSync(washWorkflowPath, washWorkflowPath + '.bak');
    }

    fs.writeFileSync(path.join(cliDir, 'memory.js'), memoryJsContent);
    fs.writeFileSync(activatePath, activateContent);
    fs.writeFileSync(evoWorkflowPath, evoWorkflowContent);
    fs.writeFileSync(washWorkflowPath, washWorkflowContent);

    // Inject CLI wrappers into .evo-lite to avoid root pollution
    const unixWrapperPath = path.join(evoLiteDir, 'evo');
    const winWrapperPath = path.join(evoLiteDir, 'evo.cmd');
    fs.writeFileSync(unixWrapperPath, unixWrapperContent);
    fs.writeFileSync(winWrapperPath, winWrapperContent);
    try {
        fs.chmodSync(unixWrapperPath, '755');
    } catch (e) { }

    console.log('✅ 核心引擎与体系模板已更新 (旧有模板已保存为 .bak 备份)。');

    // 初始化 active_context.md (绝对不能覆盖用户的上下文)
    const activeContextPath = path.join(evoLiteDir, 'active_context.md');
    if (!fs.existsSync(activeContextPath)) {
        const activeContextContent = `# 🧠 Evo-Lite Active Context\n\n> **更新时间**: ${new Date().toISOString().split('T')[0]}\n> **项目状态**: 刚刚通过 create-evo-lite 初始化。\n\n## 1. 🎯 核心目标与当前阶段\n- 请手动填写项目的最终目标。\n\n## 2. 🚧 当前进度与任务\n- 无。\n\n## 3. ⏭️ 下一步行动\n- 让 AI 阅读此文件并开始工作。`;
        fs.writeFileSync(activeContextPath, activeContextContent);
        console.log('✅ 初始化了全新的 active_context.md。');
    } else {
        console.log('🛡️ 发现并保护了已有的 active_context.md 资产。跳过覆盖！');
        if (hasUpgraded) {
            try {
                let contextContent = fs.readFileSync(activeContextPath, 'utf8');
                const warningMsg = `\n> ⚠️ **框架已热更新**: 检测到 Evo-Lite 被新版本覆盖，原有的模板文件已被转移至 \`.bak\` 后缀保护。请 AI 助手在接管时，第一步先主动为你比对 \`ACTIVATE_EVO_LITE.md\` (或其他变动文件) 与对应 \`.bak\` 的差异，将关键不同点展示给你看。**在明确询问并得到你（用户）的确认后**，再将你的旧版自定义提示词合并入新文件，并在最后删掉本条警告语及 \`.bak\` 备份。\n`;
                if (!contextContent.includes('⚠️ **框架已热更新**')) {
                    const firstHeaderRegex = /^(# .+\\n+)/;
                    if (firstHeaderRegex.test(contextContent)) {
                        contextContent = contextContent.replace(firstHeaderRegex, `$1${warningMsg}`);
                    } else {
                        contextContent = warningMsg + contextContent;
                    }
                    fs.writeFileSync(activeContextPath, contextContent);
                    console.log('🤖 已在 active_context.md 注入 AI 助手热升级处理向导标签！');
                }
            } catch (e) { }
        }

        // --- 注入清洗指令 ---
        if (shouldWash) {
            console.log('🛁 预处理记忆库，正在导出旧记忆碎片...');
            try {
                const exportJsonPath = path.join(targetDir, 'evo_memories_exported.json');
                execSync(`node "${path.join(cliDir, 'memory.js')}" export "${exportJsonPath}"`, { stdio: 'inherit' });
                console.log(`✅ 导出完成: ${exportJsonPath}`);

                let contextContent = fs.readFileSync(activeContextPath, 'utf8');
                const washMsg = `\n## ⚠️ 重要任务: 唤醒记忆库代码化清洗 (/wash)
人类开发者请求你启动 **Data Washing (洗盘) 协议**！
所有的历史记忆现在已被脱机导出至根目录的 \`evo_memories_exported.json\` 中。
**请在接管当前状态后，优先级最高地查阅 \`.agents/workflows/wash.md\`，并以此为根据编写脚本来修复、润色并替换现有的错误格式（如缺少溯源或流水账），并在完成后清理此区段提示。\n`;

                if (!contextContent.includes('Data Washing (洗盘) 协议')) {
                    const firstHeaderRegex = /^(# .+\\n+)/;
                    if (firstHeaderRegex.test(contextContent)) {
                        contextContent = contextContent.replace(firstHeaderRegex, `$1${washMsg}`);
                    } else {
                        contextContent = washMsg + contextContent;
                    }
                    fs.writeFileSync(activeContextPath, contextContent);
                    console.log('🤖 已在 active_context.md 注入洗盘协议！启动 Evo 后它将立刻着手修复。');
                }
            } catch (e) {
                console.error('❌ 脱机洗盘引导部署失败:', e.message);
            }
        }
    }

    // 4. 安装依赖
    console.log('📦 正在从 npm 抓取并编译向量数据库及核心依赖 (better-sqlite3, sqlite-vec, axios)...');
    try {
        fs.writeFileSync(path.join(evoLiteDir, 'package.json'), JSON.stringify({
            "name": "evo-lite-workspace",
            "version": SELF_VERSION,
            "private": true,
            "dependencies": {}
        }, null, 2));
        execSync('npm install better-sqlite3 sqlite-vec axios', { cwd: evoLiteDir, stdio: 'inherit' });
        console.log('✅ 依赖在线安装成功！');
    } catch (e) {
        console.warn('\n⚠️ 警告: npm 在线安装或外挂 C++ 编译失败！(可能是网络受限或未安装构建工具)');
        console.log('🛡️ 正在启动终极兜底方案：自动解压并注入脱机版预编译依赖包 (fallback-deps.zip)...');

        try {
            const fallbackZip = path.join(__dirname, 'templates', 'fallback-deps.zip');
            if (fs.existsSync(fallbackZip)) {
                // 利用现代多端原生自带的 tar 命令解压 (Win10+ 和 Mac/Linux 均原生支持)
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

    console.log('\n🎉 Evo-Lite Memory Bank 初始化完成！');
    console.log('----------------------------------------------------');
    console.log(`👉 下一步:`);
    console.log(`  1. cd ${targetDirArg}`);
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
