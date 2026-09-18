/**
 * Workflow job-gate test.
 *
 * GitHub gives every job an implicit `if: success()`, and success() is false
 * when ANY ancestor in the needs chain was skipped, not only when one failed.
 * The split-build release workflows lean on that: `build-linux` and
 * `build-download` are each gated on the `platforms` input, so a single-platform
 * re-dispatch skips one of them, and `release` only survives because it carries
 * `if: always() && ...`. Everything downstream of that always() job then has to
 * carry its own gate too, or it silently skips.
 *
 * That is exactly what happened: `upload-to-r2` and `update-releases` had no
 * `if:`, so a single-platform dispatch created the GitHub release and never
 * reached R2 or releases.json - no failure anywhere, just two skipped jobs.
 *
 * These tests parse the real workflow files, so they fail if the guards are
 * dropped or if a future job is appended to one of these chains ungated.
 */

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parse } from 'yaml'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const WORKFLOW_DIR = join(ROOT, '.github', 'workflows')

type Job = {
  needs?: string | string[]
  if?: string
}

type Workflow = {
  jobs?: Record<string, Job>
}

function readWorkflow(file: string): Workflow {
  return parse(readFileSync(join(WORKFLOW_DIR, file), 'utf8')) as Workflow
}

function needsOf(job: Job): string[] {
  if (!job.needs) return []
  return Array.isArray(job.needs) ? job.needs : [job.needs]
}

const SPLIT_BUILD_WORKFLOWS = [
  'release-sqlite.yml',
  'release-clickhouse.yml',
  'release-influxdb.yml',
]

describe('release workflow publish chains are explicitly gated', () => {
  for (const file of SPLIT_BUILD_WORKFLOWS) {
    test(`${file} gates upload-to-r2 and update-releases`, () => {
      const jobs = readWorkflow(file).jobs ?? {}

      const upload = jobs['upload-to-r2']
      assert.ok(upload, `${file} has no upload-to-r2 job`)
      assert.equal(
        upload.if,
        "always() && needs.release.result == 'success'",
        `${file}: upload-to-r2 must gate on release explicitly, or a skipped build job skips the R2 upload`,
      )

      const update = jobs['update-releases']
      assert.ok(update, `${file} has no update-releases job`)
      assert.equal(
        update.if,
        "always() && needs.upload-to-r2.result == 'success'",
        `${file}: update-releases must gate on upload-to-r2 explicitly, or releases.json is never rebuilt`,
      )
    })
  }
})

describe('every job downstream of an always() job carries its own if:', () => {
  const files = readdirSync(WORKFLOW_DIR).filter((f) => f.endsWith('.yml'))

  for (const file of files) {
    test(file, () => {
      const jobs = readWorkflow(file).jobs ?? {}

      // Seed with the jobs whose own `if:` starts with always(), then walk the
      // needs graph forward to every job that transitively depends on one.
      const tainted = new Set<string>()
      for (const [name, job] of Object.entries(jobs)) {
        if (typeof job?.if === 'string' && job.if.includes('always()')) {
          tainted.add(name)
        }
      }

      let grew = true
      while (grew) {
        grew = false
        for (const [name, job] of Object.entries(jobs)) {
          if (tainted.has(name)) continue
          if (needsOf(job ?? {}).some((dep) => tainted.has(dep))) {
            tainted.add(name)
            grew = true
          }
        }
      }

      for (const [name, job] of Object.entries(jobs)) {
        if (!tainted.has(name)) continue
        assert.equal(
          typeof job?.if,
          'string',
          `${file}: job "${name}" depends on a job gated with always(), so the implicit success() gate skips it whenever an ancestor is skipped. Give it its own if:.`,
        )
      }
    })
  }
})
