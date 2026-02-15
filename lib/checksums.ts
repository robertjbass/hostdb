/**
 * Shared checksum utilities for fetching and parsing checksums.txt files
 */

type GitHubAsset = {
  id: number
  name: string
  browser_download_url: string
}

type GitHubRelease = {
  assets: GitHubAsset[]
}

/**
 * Parse checksums.txt content into a record of filename -> hash
 */
export function parseChecksums(content: string): Record<string, string> {
  const checksums: Record<string, string> = {}

  for (const line of content.split('\n')) {
    // Format: "hash  filename" or "hash *filename" (binary mode)
    const match = line.match(/^([a-f0-9]{64})\s+\*?(.+)$/)
    if (match) {
      checksums[match[2]] = match[1]
    }
  }

  return checksums
}

/**
 * Fetch checksums.txt from a GitHub release using the API (avoids CDN caching issues)
 *
 * @param repo - Repository in "owner/repo" format
 * @param tag - Release tag name
 * @returns Record of filename -> SHA256 hash, or empty object if not found
 */
export async function fetchChecksums(
  repo: string,
  tag: string,
): Promise<Record<string, string>> {
  // First try to get the asset URL from the API
  const apiUrl = `https://api.github.com/repos/${repo}/releases/tags/${tag}`
  const apiResponse = await fetch(apiUrl, {
    headers: {
      Accept: 'application/vnd.github.v3+json',
      'User-Agent': 'hostdb-checksums',
      ...(process.env.GITHUB_TOKEN
        ? { Authorization: `Bearer ${process.env.GITHUB_TOKEN}` }
        : {}),
    },
  })

  if (!apiResponse.ok) {
    return {}
  }

  const release = (await apiResponse.json()) as GitHubRelease
  const checksumAsset = release.assets.find((a) => a.name === 'checksums.txt')

  if (!checksumAsset) {
    return {}
  }

  // Use API asset download (works for both private and public repos)
  const assetApiUrl = `https://api.github.com/repos/${repo}/releases/assets/${checksumAsset.id}`
  const assetApiResponse = await fetch(assetApiUrl, {
    headers: {
      Accept: 'application/octet-stream',
      'User-Agent': 'hostdb-checksums',
      ...(process.env.GITHUB_TOKEN
        ? { Authorization: `Bearer ${process.env.GITHUB_TOKEN}` }
        : {}),
    },
    redirect: 'follow',
  })

  if (assetApiResponse.ok) {
    const content = await assetApiResponse.text()
    return parseChecksums(content)
  }

  // Fallback: try browser_download_url (only works for public repos)
  if (!process.env.GITHUB_TOKEN) {
    const browserResponse = await fetch(
      checksumAsset.browser_download_url,
      {
        headers: { 'User-Agent': 'hostdb-checksums' },
        redirect: 'follow',
      },
    )

    if (browserResponse.ok) {
      const content = await browserResponse.text()
      return parseChecksums(content)
    }
  }

  return {}
}
