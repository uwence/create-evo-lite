const { exec } = require('child_process');
const fs = require('fs');
const path = require('path');

async function runTests() {
    console.log('--- 1. Testing --file argument ---');
    const testFile = path.join(__dirname, 'test-input.txt');
    fs.writeFileSync(testFile, 'This is a long test string with special characters like " quotes and $ dollars and \n newlines to test OS truncation.', 'utf8');

    await new Promise((resolve) => {
        exec(`node .evo-lite/cli/memory.js remember --file="${testFile}"`, (error, stdout, stderr) => {
            console.log(stdout.trim());
            if (error || stderr) console.error(error || stderr);
            resolve();
        });
    });

    console.log('\n--- 2. Testing SQLite Concurrency (10 parallel writes) ---');
    const promises = [];
    for (let i = 0; i < 10; i++) {
        promises.push(new Promise((resolve) => {
            exec(`node .evo-lite/cli/memory.js remember "并发写入测试条目 Payload ${i}"`, (error, stdout, stderr) => {
                const outputLine = stdout.trim().split('\n').pop(); // Usually prints "✅ Remembered! (ID: ...)"
                console.log(`[Process ${i}] output:`, outputLine);
                if (error) console.error(`[Process ${i}] Error:`, error.message);
                resolve();
            });
        }));
    }

    await Promise.all(promises);

    // Cleanup
    fs.unlinkSync(testFile);
    console.log('\n✅ Regression tests complete!');
}

runTests();
