const fs = require('fs');
const path = require('path');
const tar = require('tar');
const { pipeline, env } = require('@xenova/transformers');
const { getDb } = require('./db');
const { getCacheDir, getDbPath, getRuntimeRoot } = require('./runtime');

const DB_PATH = getDbPath();

let ACTIVE_MODEL = 'Xenova/jina-embeddings-v2-base-zh';
let ACTIVE_DIMS = 768;
const FALLBACK_MODEL = 'Xenova/bge-small-zh-v1.5';
const FALLBACK_DIMS = 512;
const RERANKER_MODEL = 'Xenova/bge-reranker-base';

let extractorPipeline = null;
let rerankerPipeline = null;

function configureEnv() {
    env.allowLocalModels = true;
    env.cacheDir = getCacheDir();
    env.remoteHost = 'https://hf-mirror.com';
    env.remotePathTemplate = '{model}/resolve/{revision}/';
}

function extractTarFallback() {
    const runtimeRoot = getRuntimeRoot();
    const fallbackName = FALLBACK_MODEL.split('/')[1];
    const tarballCandidates = [
        path.join(runtimeRoot, 'models', `${fallbackName}.tar.gz`),
        path.join(runtimeRoot, 'models', `${fallbackName}.tar`),
        path.join(runtimeRoot, `${fallbackName}.tar.gz`),
        path.join(runtimeRoot, 'embedding-model.tar.gz'),
        path.join(runtimeRoot, '..', 'templates', 'embedding-model.tar.gz'),
    ];

    for (const tarballPath of tarballCandidates) {
        if (fs.existsSync(tarballPath)) {
            try {
                tar.x({ file: tarballPath, cwd: getCacheDir(), sync: true });
                return true;
            } catch (_) {
                continue;
            }
        }
    }

    return false;
}

function resetPipelines() {
    extractorPipeline = null;
    rerankerPipeline = null;
}

function setActiveModel(model, dims) {
    ACTIVE_MODEL = model;
    ACTIVE_DIMS = dims;
    resetPipelines();
}

async function initEmbeddingModel(forceReload = false) {
    configureEnv();

    if (forceReload) {
        resetPipelines();
    }

    if (fs.existsSync(DB_PATH)) {
        try {
            const db = getDb();
            const row = db.prepare("SELECT value FROM _meta WHERE key = 'embedding_model'").get();
            const dimsRow = db.prepare("SELECT value FROM _meta WHERE key = 'embedding_dims'").get();
            if (row && row.value) {
                ACTIVE_MODEL = row.value;
                ACTIVE_DIMS = dimsRow ? parseInt(dimsRow.value, 10) : (ACTIVE_MODEL === FALLBACK_MODEL ? FALLBACK_DIMS : 768);
            }
        } catch (_) {
            // Ignore metadata probing failures during bootstrap.
        }
    }

    try {
        if (!extractorPipeline) {
            extractorPipeline = await pipeline('feature-extraction', ACTIVE_MODEL);
        }
    } catch (error) {
        console.warn(`\n⚠️ \x1b[33m网络加载模型 ${ACTIVE_MODEL} 失败: ${error.message}\n🔄 正在降级至本地小模型 ${FALLBACK_MODEL}...\x1b[0m`);
        ACTIVE_MODEL = FALLBACK_MODEL;
        ACTIVE_DIMS = FALLBACK_DIMS;
        extractTarFallback();

        try {
            extractorPipeline = await pipeline('feature-extraction', ACTIVE_MODEL, { quantized: true });
            console.log('✅ \x1b[32m成功降级！已加载本地兜底模型。\x1b[0m');
        } catch (fallbackError) {
            console.warn(`\x1b[31m❌ 本地降级模型加载也失败了: ${fallbackError.message}\x1b[0m`);
            extractorPipeline = null;
        }
    }

    return extractorPipeline;
}

async function getExtractor() {
    if (!extractorPipeline) {
        await initEmbeddingModel();
    }
    return extractorPipeline;
}

async function getReranker() {
    configureEnv();

    if (!rerankerPipeline) {
        try {
            rerankerPipeline = await pipeline('text-classification', RERANKER_MODEL, { quantized: true });
        } catch (error) {
            console.error(`[FATAL] Failed to load reranker model ${RERANKER_MODEL}. Reranking will be disabled.`);
            console.error(error);
            rerankerPipeline = null;
        }
    }

    return rerankerPipeline;
}

function getActiveModelInfo() {
    return { model: ACTIVE_MODEL, dims: ACTIVE_DIMS };
}

function getModelConstants() {
    return {
        FALLBACK_DIMS,
        FALLBACK_MODEL,
        RERANKER_MODEL,
    };
}

module.exports = {
    getActiveModelInfo,
    getExtractor,
    getModelConstants,
    getReranker,
    initEmbeddingModel,
    resetPipelines,
    setActiveModel,
};
