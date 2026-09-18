/**
 * Which GitHub releases the manifest is allowed to describe.
 *
 * `releases.json` is rebuilt from the GitHub Releases list, and that list
 * includes DRAFTS for anyone holding a token with write access - which the
 * `update-releases` job does. A draft is a release still being assembled: its
 * assets are whatever has finished uploading so far, its `published_at` is
 * null, and its tag does not exist in git yet.
 *
 * On 2026-09-17 the MariaDB manifest job ran while the 12.3.3 draft still had
 * three of its five platforms uploaded, and committed exactly that to main and
 * to R2: `12.3.3` with 3 platforms and `releasedAt: null`. The next manifest
 * run healed it, but between the two a consumer resolving 12.3.3 saw two of its
 * platforms simply missing. Drafts are skipped outright rather than tolerated,
 * because a half-uploaded release is never something to snapshot.
 *
 * (builds/common/publish-release.sh closes the same gap from the other side by
 * keeping a release a draft until every asset is uploaded and verified. This
 * filter is what makes a draft harmless regardless of how it got there.)
 */

export type ReleaseDraftState = {
  tag_name: string
  draft?: boolean
  published_at?: string | null
}

/** True when a release is a draft, or has never been published. */
export function isDraftRelease(release: ReleaseDraftState): boolean {
  return (
    release.draft === true ||
    release.published_at === null ||
    release.published_at === undefined
  )
}

/**
 * Drop every draft from a fetched release list.
 *
 * Returns the publishable releases plus the tags that were skipped, so the
 * caller can say so in its log rather than silently shrinking the manifest.
 */
export function selectPublishedReleases<T extends ReleaseDraftState>(
  releases: readonly T[],
): { published: T[]; skippedDraftTags: string[] } {
  const published: T[] = []
  const skippedDraftTags: string[] = []

  for (const release of releases) {
    if (isDraftRelease(release)) {
      skippedDraftTags.push(release.tag_name)
      continue
    }
    published.push(release)
  }

  return { published, skippedDraftTags }
}
