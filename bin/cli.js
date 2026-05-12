#!/usr/bin/env node
const { handleCliError, main } = require('../index.js');

main().catch(handleCliError);
