const fs = require('fs');
const path = require('path');
const tar = require('tar');
const { pipeline, env } = require('@xenova/transformers');
const { getDb } = require('./db');
const { getCacheDir, getDbPath, getRerankerStatePath, getRuntimeRoot } = require('./runtime');

const DB_PATH = getDbPath();

let ACTIVE_MODEL = 'Xenova/jina-embeddings-v2-base-zh';
let ACTIVE_DIMS = 768;
const FALLBACK_MODEL = 'Xenova/bge-small-zh-v1.5';
const FALLBACK_DIMS = 512;
const RERANKER_MODEL = 'Xenova/bge-reranker-base';

let extractorPipeline = null;
let rerankerPipeline = null;
let rerankerDisabled = false;

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
    rerankerDisabled = false;
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

function readRerankerState() {
    const statePath = getRerankerStatePath();
    if (!fs.existsSync(statePath)) {
        return null;
    }
    try {
        return JSON.parse(fs.readFileSync(statePath, 'utf8'));
    } catch (_) {
        return null;
    }
}

function writeRerankerState(state) {
    fs.writeFileSync(getRerankerStatePath(), JSON.stringify(state, null, 2), 'utf8');
}

function clearRerankerState() {
    const statePath = getRerankerStatePath();
    if (fs.existsSync(statePath)) {
        try {
            fs.unlinkSync(statePath);
        } catch (_) {}
    }
}

function summarizeRerankerError(error) {
    const causeCode = error && error.cause && error.cause.code ? ` (${error.cause.code})` : '';
    const message = String(error && error.message ? error.message : 'unknown error').split('\n')[0];
    return `${message}${causeCode}`;
}

function getRerankerStatus() {
    const state = readRerankerState();
    return state || { disabled: false, model: RERANKER_MODEL };
}

async function getReranker(options = {}) {
    configureEnv();
    const allowRetry = options.allowRetry === true;

    if (process.env.EVO_LITE_FORCE_RERANKER_FAILURE === '1') {
        const simulatedState = {
            disabled: true,
            message: 'simulated reranker failure',
            model: RERANKER_MODEL,
            reason: 'network',
            updated_at: new Date().toISOString(),
        };
        writeRerankerState(simulatedState);
        rerankerDisabled = true;
        rerankerPipeline = null;
        return null;
    }

    if (process.env.EVO_LITE_FORCE_RERANKER_SUCCESS === '1' && allowRetry) {
        clearRerankerState();
        rerankerDisabled = false;
        if (!rerankerPipeline) {
            rerankerPipeline = async () => [{ score: 1 }];
        }
        return rerankerPipeline;
    }

    if (rerankerPipeline && !rerankerDisabled) {
        return rerankerPipeline;
    }

    const rerankerState = getRerankerStatus();
    if (!allowRetry && (rerankerDisabled || rerankerState.disabled)) {
        rerankerDisabled = true;
        return null;
    }

    try {
        rerankerPipeline = await pipeline('text-classification', RERANKER_MODEL, { quantized: true });
        rerankerDisabled = false;
        clearRerankerState();
    } catch (error) {
        writeRerankerState({
            disabled: true,
            message: summarizeRerankerError(error),
            model: RERANKER_MODEL,
            reason: 'network',
            updated_at: new Date().toISOString(),
        });
        rerankerPipeline = null;
        rerankerDisabled = true;
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
    getRerankerStatus,
    initEmbeddingModel,
    resetPipelines,
    setActiveModel,
};
