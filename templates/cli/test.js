const assert = require('assert');
const { getDb } = require('./db');
const memoryService = require('./memory.service');
const { initEmbeddingModel, getActiveModelInfo } = require('./models');

async function runTests() {
    console.log('--- Starting Tests ---');

    try {
        // 1. Initialize models and DB
        console.log('1. Initializing models and database...');
        await initEmbeddingModel();
        const { model, dims } = getActiveModelInfo();
        const { initDB } = require('./db');
        initDB(model, dims);

        const db = getDb();

        // Clear out raw_memory for test predictability
        db.exec('DELETE FROM raw_memory;');
        db.exec('DELETE FROM chunks;');
        db.exec('DELETE FROM vectors;');

        // 2. Test Memorize
        console.log('2. Testing memorize()...');
        const testContent = "This is a unique test memory fragment to test semantic search functionality in Evo-Lite.";
        await memoryService.memorize(testContent);

        const rowCount = db.prepare('SELECT COUNT(*) as count FROM raw_memory').get();
        assert.strictEqual(rowCount.count, 1, 'Memory was not inserted properly');

        // 3. Test Recall
        console.log('3. Testing recall()...');
        const recallResults = await memoryService.recall("semantic search functionality");

        assert.ok(recallResults.length > 0, 'Recall returned no results');
        assert.strictEqual(recallResults[0].content, testContent, 'Recalled content did not match expected test memory');

        // 4. Test Verification sync
        console.log('4. Testing verify()...');
        memoryService.verify(); // Output will be logged to console

        console.log('--- All tests passed! ---');
    } catch (err) {
        console.error('❌ Test failed:', err);
        process.exit(1);
    }
}

runTests();
