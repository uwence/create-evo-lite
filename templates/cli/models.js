const ENGINE_ID = 'sqlite-fts5-trigram';
const ENGINE_SCHEMA_VERSION = '1';
const LEGACY_DISABLED_RERANKER_ID = 'disabled-local-engine';

let activeEngine = ENGINE_ID;
let activeVersion = ENGINE_SCHEMA_VERSION;

function getModel(id) {
    if (id !== ENGINE_ID) {
        return null;
    }
    return {
        id: ENGINE_ID,
        hfRepo: null,
        dims: ENGINE_SCHEMA_VERSION,
        kind: 'text',
        quantized: false,
        fallback: null,
    };
}

function listModels() {
    return [getModel(ENGINE_ID)];
}

function resetPipelines() {}

function setActiveEngine(engine = ENGINE_ID, version = ENGINE_SCHEMA_VERSION) {
    activeEngine = engine;
    activeVersion = version;
}

async function initLocalIndexEngine(forceReload = false) {
    if (forceReload) {
        setActiveEngine();
    }
    return { model: activeEngine, dims: activeVersion };
}

async function getExtractor() {
    return null;
}

function getIndexStatus() {
    return {
        disabled: true,
        model: LEGACY_DISABLED_RERANKER_ID,
        reason: 'removed',
    };
}

async function getReranker() {
    return null;
}

function getActiveEngineInfo() {
    return { model: activeEngine, dims: activeVersion };
}

function getEngineConstants() {
    return {
        FALLBACK_DIMS: ENGINE_SCHEMA_VERSION,
        FALLBACK_MODEL: ENGINE_ID,
        RERANKER_MODEL: LEGACY_DISABLED_RERANKER_ID,
    };
}

const setActiveModel = setActiveEngine;
const initEmbeddingModel = initLocalIndexEngine;
const getRerankerStatus = getIndexStatus;
const getActiveModelInfo = getActiveEngineInfo;
const getModelConstants = getEngineConstants;

module.exports = {
    MODEL_REGISTRY: {
        [ENGINE_ID]: getModel(ENGINE_ID),
    },
    getActiveEngineInfo,
    getActiveModelInfo,
    getEngineConstants,
    getExtractor,
    getModel,
    getModelConstants,
    getReranker,
    getIndexStatus,
    getRerankerStatus,
    initEmbeddingModel,
    initLocalIndexEngine,
    listModels,
    resetPipelines,
    setActiveEngine,
    setActiveModel,
};
