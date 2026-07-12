'use strict';

// TEST ASSET ONLY. A fake CodePerceptionProvider that implements the
// Task-1 contract (../../code-perception/provider-contract) and reads its
// data from static JSON fixtures alongside this file. NO subprocess, NO fs
// walking beyond these static JSON requires, NO CodeGraph, NO network.
// It exists to drive loader/router tests via registry injection and must
// NEVER be added to the production DEFAULT_REGISTRY.

const contract = require('../../../code-perception/provider-contract');
const normalize = require('../../../code-perception/normalize');

const status = require('./fixture-status.json');
const query = require('./fixture-query.json');
const callers = require('./fixture-callers.json');
const impactRaw = require('./fixture-impact.json');

const PROVIDER_ID = 'provider:fixture';
const ADAPTER_VERSION = '0.0.1-fixture';

function buildCapabilities() {
    const capabilities = {};
    for (const key of contract.CAPABILITY_KEYS) {
        capabilities[key] = key === 'symbols' || key === 'callers' || key === 'impact';
    }
    return capabilities;
}

function create() {
    const capabilities = buildCapabilities();

    const provider = {
        id: PROVIDER_ID,
        name: 'Fixture Structural Provider',
        adapterVersion: ADAPTER_VERSION,
        capabilities,

        check() {
            return {
                available: true,
                ready: true,
                installed: true,
                indexState: status.indexState,
            };
        },

        getStatus() {
            return {
                providerId: PROVIDER_ID,
                adapterVersion: ADAPTER_VERSION,
                available: true,
                ready: true,
                indexState: status.indexState,
                dirty: status.dirty,
                freshness: status.freshness,
                compatibility: status.compatibility,
                capabilities: buildCapabilities(),
                diagnostics: [],
            };
        },

        search(providerContext, searchQuery) {
            return normalize.normalizeSearchResult(provider.getStatus(providerContext), query);
        },

        getCallers(providerContext, ref) {
            return callers.map(rel => normalize.normalizeRelationship(
                PROVIDER_ID, rel.source, rel.target, rel.kind, rel.confidence
            ));
        },

        impact(providerContext, ref) {
            return normalize.normalizeImpactResult(provider.getStatus(providerContext), impactRaw);
        },
    };

    return provider;
}

module.exports = { create };
