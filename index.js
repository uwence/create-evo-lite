const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const readline = require('readline/promises');

async function main() {
    const targetDirArg = process.argv[2];
    if (!targetDirArg) {
        console.error('❌ 错误: 请指定目标项目目录。');
        console.error('👉 用法: node index.js <项目路径>');
        console.error('💡 示例: node index.js ./MyAwesomeProject');
        process.exit(1);
    }

    const targetDir = path.resolve(targetDirArg);
    console.log(`🚀 开始在 ${targetDir} 初始化 Evo-Lite Daemonless 记忆大脑...\n`);

    // --- 交互式向导 ---
    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout
    });

    console.log('================= 配置向导 =================');
    console.log('直接按回车可使用默认的 LM Studio 本地配置。');
    const embedUrl = await rl.question('1. Embedding API URL [http://localhost:12342/v1/embeddings]: ') || 'http://localhost:12342/v1/embeddings';
    const embedModel = await rl.question('2. Embedding 模型名称 [jina-embeddings-v2-base-zh]: ') || 'jina-embeddings-v2-base-zh';
    const rerankUrl = await rl.question('3. Reranker API URL [http://localhost:12342/v1/rerank]: ') || 'http://localhost:12342/v1/rerank';
    const rerankModel = await rl.question('4. Reranker 模型名称 [text-embedding-bge-reranker-base]: ') || 'text-embedding-bge-reranker-base';
    console.log('============================================\n');
    rl.close();

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

    // 将向导中的配置注入到 memory.js 中
    memoryJsContent = memoryJsContent
        .replace(/const LM_STUDIO_URL = '.*?';/, `const LM_STUDIO_URL = '${embedUrl}';`)
        .replace(/const LM_STUDIO_RERANK_URL = '.*?';/, `const LM_STUDIO_RERANK_URL = '${rerankUrl}';`)
        .replace(/const MODEL_NAME = '.*?';/, `const MODEL_NAME = '${embedModel}';`)
        .replace(/const RERANKER_MODEL = '.*?';/, `const RERANKER_MODEL = '${rerankModel}';`);

    fs.writeFileSync(path.join(cliDir, 'memory.js'), memoryJsContent);
    fs.writeFileSync(path.join(evoLiteDir, 'ACTIVATE_EVO_LITE.md'), activateContent);
    fs.writeFileSync(path.join(workflowsDir, 'evo.md'), evoWorkflowContent);

    // 初始化 active_context.md
    const activeContextContent = `# 🧠 Evo-Lite Active Context\n\n> **更新时间**: ${new Date().toISOString().split('T')[0]}\n> **项目状态**: 刚刚通过 create-evo-lite 初始化。\n\n## 1. 🎯 核心目标与当前阶段\n- 请手动填写项目的最终目标。\n\n## 2. 🚧 当前进度与任务\n- 无。\n\n## 3. ⏭️ 下一步行动\n- 让 AI 阅读此文件并开始工作。`;
    fs.writeFileSync(path.join(evoLiteDir, 'active_context.md'), activeContextContent);

    // 4. 安装依赖
    console.log('📦 正在从 npm 抓取并编译向量数据库及核心依赖 (better-sqlite3, sqlite-vec, axios)...');
    try {
        fs.writeFileSync(path.join(evoLiteDir, 'package.json'), JSON.stringify({
            "name": "evo-lite-workspace",
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
