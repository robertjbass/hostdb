#!/usr/bin/env -S npx tsx
import { spawnSync } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

let version = '1.0.0'
let output = './dist'
let platforms = [`${process.platform}-${process.arch}`]
const args = process.argv.slice(2)
for (let index = 0; index < args.length; index++) {
  const argument = args[index]
  switch (argument) {
    case '--':
      break
    case '--version':
      version = args[++index] ?? ''
      break
    case '--platform':
      platforms = [args[++index] ?? '']
      break
    case '--output':
      output = args[++index] ?? ''
      break
    case '--all-platforms':
      platforms = ['linux-x64', 'linux-arm64']
      break
    default:
      throw new Error(`Unknown argument: ${argument}`)
  }
}
if (version !== '1.0.0' || !output)
  throw new Error(
    'DocumentDB requires version 1.0.0 and a non-empty output path',
  )
for (const platform of platforms) {
  if (!['linux-x64', 'linux-arm64'].includes(platform))
    throw new Error(`Native DocumentDB is not available for ${platform}`)
  const result = spawnSync(
    '/bin/bash',
    [
      join(dirname(fileURLToPath(import.meta.url)), 'build-local.sh'),
      '--version',
      version,
      '--platform',
      platform,
      '--output',
      output,
    ],
    { stdio: 'inherit' },
  )
  if (result.error) throw result.error
  if (result.status !== 0)
    throw new Error(
      `DocumentDB ${platform} build failed; no partial release may be published`,
    )
}
