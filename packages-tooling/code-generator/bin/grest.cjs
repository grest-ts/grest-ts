#!/usr/bin/env node

/**
 * Grest Code Generator CLI wrapper
 *
 * This wrapper script invokes tsx to run the TypeScript CLI.
 * It handles cross-platform execution and ensures tsx is available.
 */

const {spawn} = require('child_process')
const path = require('path')

const runnerPath = path.join(__dirname, 'grestRunner.ts')

// Spawn tsx with the TypeScript runner
const child = spawn('npx', ['tsx', runnerPath, ...process.argv.slice(2)], {
    stdio: 'inherit',
    shell: true
})

child.on('exit', (code) => {
    process.exit(code ?? 0)
})

child.on('error', (err) => {
    console.error('Failed to start grest CLI:', err.message)
    console.error('Make sure tsx is installed: npm install -D tsx')
    process.exit(1)
})
