/**
 * The manifest must never describe a draft release.
 *
 * On 2026-09-17 the `update-releases` job for the MariaDB wave ran while the
 * 12.3.3 release was still a draft with 3 of its 5 archives uploaded. The job's
 * token can see drafts, so build-releases-json.ts counted it and committed
 * `12.3.3` with 3 platforms and `releasedAt: null` to main and to R2. The next
 * manifest run repaired it, but consumers resolving those two platforms in
 * between got nothing.
 *
 * The fixture below is that release list: two finished releases and the
 * half-uploaded draft between them.
 */

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'

import {
  isDraftRelease,
  selectPublishedReleases,
} from '../lib/github-releases.ts'

const PUBLISHED_11_8_9 = {
  tag_name: 'mariadb-11.8.9',
  draft: false,
  published_at: '2026-09-17T14:02:11Z',
  assets: [
    { name: 'mariadb-11.8.9-linux-x64.tar.gz' },
    { name: 'mariadb-11.8.9-linux-arm64.tar.gz' },
    { name: 'mariadb-11.8.9-darwin-x64.tar.gz' },
    { name: 'mariadb-11.8.9-darwin-arm64.tar.gz' },
    { name: 'mariadb-11.8.9-win32-x64.zip' },
    { name: 'checksums.txt' },
  ],
}

const DRAFT_12_3_3 = {
  tag_name: 'mariadb-12.3.3',
  draft: true,
  published_at: null,
  assets: [
    { name: 'mariadb-12.3.3-darwin-arm64.tar.gz' },
    { name: 'mariadb-12.3.3-darwin-x64.tar.gz' },
    { name: 'mariadb-12.3.3-linux-arm64.tar.gz' },
  ],
}

const PUBLISHED_13_0_2 = {
  tag_name: 'mariadb-13.0.2',
  draft: false,
  published_at: '2026-09-17T18:44:03Z',
  assets: [
    { name: 'mariadb-13.0.2-linux-x64.tar.gz' },
    { name: 'checksums.txt' },
  ],
}

const RELEASE_LIST = [PUBLISHED_11_8_9, DRAFT_12_3_3, PUBLISHED_13_0_2]

describe('isDraftRelease', () => {
  test('flags a release marked draft', () => {
    assert.equal(isDraftRelease(DRAFT_12_3_3), true)
  })

  test('flags a release that has never been published', () => {
    assert.equal(
      isDraftRelease({ tag_name: 'mariadb-12.3.3', published_at: null }),
      true,
    )
    assert.equal(isDraftRelease({ tag_name: 'mariadb-12.3.3' }), true)
  })

  test('does not flag a finished release', () => {
    assert.equal(isDraftRelease(PUBLISHED_11_8_9), false)
    assert.equal(isDraftRelease(PUBLISHED_13_0_2), false)
  })
})

describe('selectPublishedReleases', () => {
  test('drops the draft and keeps every published release, in order', () => {
    const { published, skippedDraftTags } =
      selectPublishedReleases(RELEASE_LIST)

    assert.deepEqual(
      published.map((release) => release.tag_name),
      ['mariadb-11.8.9', 'mariadb-13.0.2'],
    )
    assert.deepEqual(skippedDraftTags, ['mariadb-12.3.3'])
  })

  test('the half-uploaded assets never reach the caller', () => {
    const { published } = selectPublishedReleases(RELEASE_LIST)
    const names = published.flatMap((release) =>
      release.assets.map((asset) => asset.name),
    )

    assert.ok(
      !names.some((name) => name.includes('12.3.3')),
      'no asset of the draft release should survive the filter',
    )
  })

  test('a list with no drafts passes through untouched', () => {
    const { published, skippedDraftTags } = selectPublishedReleases([
      PUBLISHED_11_8_9,
      PUBLISHED_13_0_2,
    ])

    assert.equal(published.length, 2)
    assert.deepEqual(skippedDraftTags, [])
  })

  test('an all-draft list yields nothing rather than throwing', () => {
    const { published, skippedDraftTags } = selectPublishedReleases([
      DRAFT_12_3_3,
    ])

    assert.deepEqual(published, [])
    assert.deepEqual(skippedDraftTags, ['mariadb-12.3.3'])
  })
})
