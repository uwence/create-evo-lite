const ENGINE_MODEL = 'sqlite-fts5-trigram';
const ENGINE_VERSION = '1';
const DISABLED_RERANKER = 'disabled-local-engine';

let activeModel = ENGINE_MODEL;
let activeDims = ENGINE_VERSION;

function getModel(id) {
    if (id !== ENGINE_MODEL) {
        return null;
    }
    return {
        id: ENGINE_MODEL,
        hfRepo: null,
        dims: ENGINE_VERSION,
        kind: 'text',
        quantized: false,
        fallback: null,
    };
}

function listModels() {
    return [getModel(ENGINE_MODEL)];
}

function resetPipelines() {}

function setActiveModel(model = ENGINE_MODEL, dims = ENGINE_VERSION) {
    activeModel = model;
    activeDims = dims;
}

async function initEmbeddingModel(forceReload = false) {
    if (forceReload) {
        setActiveModel();
    }
    return { model: activeModel, dims: activeDims };
}

async function getExtractor() {
    return null;
}

function getRerankerStatus() {
    return {
        disabled: true,
        model: DISABLED_RERANKER,
        reason: 'removed',
    };
}

async function getReranker() {
    return null;
}

function getActiveModelInfo() {
    return { model: activeModel, dims: activeDims };
}

function getModelConstants() {
    return {
        FALLBACK_DIMS: ENGINE_VERSION,
        FALLBACK_MODEL: ENGINE_MODEL,
        RERANKER_MODEL: DISABLED_RERANKER,
    };
}

module.exports = {
    MODEL_REGISTRY: {
        [ENGINE_MODEL]: getModel(ENGINE_MODEL),
    },
    getActiveModelInfo,
    getExtractor,
    getModel,
    getModelConstants,
    getReranker,
    getRerankerStatus,
    initEmbeddingModel,
    listModels,
    resetPipelines,
    setActiveModel,
};
