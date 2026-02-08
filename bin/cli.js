#!/usr/bin/env node

import { fileURLToPath, pathToFileURL } from 'node:url'
import { dirname, join } from 'node:path'
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { createRequire } from 'node:module'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

const packageRoot = join(__dirname, '..')
const mainScript = join(packageRoot, 'cli', 'bin.ts')

// Find tsx ESM loader using Node's module resolution
let tsxLoader = null

try {
  const require = createRequire(import.meta.url)
  const tsxDir = dirname(require.resolve('tsx/package.json'))
  const loaderPaths = [
    join(tsxDir, 'dist', 'esm', 'index.mjs'),
    join(tsxDir, 'dist', 'loader.mjs'),
  ]
  tsxLoader = loaderPaths.find((p) => existsSync(p))
} catch {
  // tsx not found via module resolution
}

if (!tsxLoader) {
  console.error('Error: tsx loader not found.')
  console.error('\nTry running: pnpm install')
  process.exit(1)
}

const tsxLoaderUrl = pathToFileURL(tsxLoader).href

const child = spawn(
  process.execPath,
  ['--import', tsxLoaderUrl, mainScript, ...process.argv.slice(2)],
  {
    stdio: 'inherit',
    shell: false,
    cwd: packageRoot,
  },
)

// Forward termination signals to child process
const forwardSignal = (signal) => {
  if (child.pid && !child.killed) {
    child.kill(signal)
  }
}

process.on('SIGINT', () => forwardSignal('SIGINT'))
process.on('SIGTERM', () => forwardSignal('SIGTERM'))
process.on('SIGHUP', () => forwardSignal('SIGHUP'))

child.on('exit', (code, signal) => {
  // Clean up signal handlers
  process.removeAllListeners('SIGINT')
  process.removeAllListeners('SIGTERM')
  process.removeAllListeners('SIGHUP')

  // Exit with same code or signal-based exit code
  if (signal) {
    process.exit(
      128 + (signal === 'SIGINT' ? 2 : signal === 'SIGTERM' ? 15 : 1),
    )
  }
  process.exit(code ?? 0)
})

child.on('error', (err) => {
  console.error('Failed to start hostdb:', err.message)
  process.exit(1)
})
