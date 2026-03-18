const fs = require('fs');
const path = require('path');
const { pipeline, env } = require('@xenova/transformers');
const { getDb } = require('./db');
const tar = require('tar');

// Configure environment for Transformers.js
env.allowLocalModels = true;
env.cacheDir = path.join(__dirname, '..', '.cache');
env.remoteHost = 'https://hf-mirror.com';
env.remotePathTemplate = '{model}/resolve/{revision}/';

const DB_PATH = path.join(__dirname, '..', 'memory.db');

let ACTIVE_MODEL = 'Xenova/jina-embeddings-v2-base-zh';
let ACTIVE_DIMS = 768;
const FALLBACK_MODEL = 'Xenova/bge-small-zh-v1.5';
const FALLBACK_DIMS = 512;
const RERANKER_MODEL = 'Xenova/bge-reranker-base';

let extractorPipeline = null;
let rerankerPipeline = null;

function extractTarFallback() {
    const modelsDir = path.join(__dirname, '..', '..', 'models');
    const tarballPath = path.join(modelsDir, `${FALLBACK_MODEL.split('/')[1]}.tar`);
    const extractDir = path.join(modelsDir, 'Xenova');

    if (fs.existsSync(tarballPath) && !fs.existsSync(path.join(extractDir, FALLBACK_MODEL.split('/')[1]))) {
        fs.mkdirSync(extractDir, { recursive: true });
        tar.x({ file: tarballPath, C: extractDir, sync: true });
    }
}

async function initEmbeddingModel() {
    if (fs.existsSync(DB_PATH)) {
        try {
            const db = getDb();
            const row = db.prepare("SELECT value FROM _meta WHERE key = 'embedding_model'").get();
            if (row && row.value) {
                ACTIVE_MODEL = row.value;
                ACTIVE_DIMS = (ACTIVE_MODEL === FALLBACK_MODEL) ? FALLBACK_DIMS : 768;
            }
        } catch (e) { /* ignore */ }
    }

    try {
        if (!extractorPipeline) {
            extractorPipeline = await pipeline('feature-extraction', ACTIVE_MODEL);
        }
    } catch (e) {
        console.warn(`\\n⚠️ \x1b[33m网络加载模型 ${ACTIVE_MODEL} 失败: ${e.message}\\n🔄 正在降级至本地小模型 ${FALLBACK_MODEL} (1/2)...\x1b[0m`);
        ACTIVE_MODEL = FALLBACK_MODEL;
        ACTIVE_DIMS = FALLBACK_DIMS;
        extractTarFallback();
        try {
            extractorPipeline = await pipeline('feature-extraction', ACTIVE_MODEL, { quantized: true });
            console.log(`✅ \x1b[32m成功降级！已加载提取了本地压缩包的小型权重。\x1b[0m`);
        } catch (err) {
            console.warn(`\x1b[31m❌ 本地降级模型加载也失败了: ${err.message}\x1b[0m`);
        }
    }
}

async function getExtractor() {
    if (!extractorPipeline) {
        await initEmbeddingModel();
    }
    return extractorPipeline;
}

async function getReranker() {
    if (!rerankerPipeline) {
        try {
            rerankerPipeline = await pipeline('text-classification', RERANKER_MODEL, { quantized: true });
        } catch (e) {
            console.error(`[FATAL] Failed to load reranker model ${RERANKER_MODEL}. Reranking will be disabled.`);
            console.error(e);
            rerankerPipeline = null;
        }
    }
    return rerankerPipeline;
}

function getActiveModelInfo() {
    return { model: ACTIVE_MODEL, dims: ACTIVE_DIMS };
}

module.exports = {
    getExtractor,
    getReranker,
    getActiveModelInfo,
    initEmbeddingModel,
};
