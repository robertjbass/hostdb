/**
 * Configurable registry base URL for binary downloads.
 *
 * Switch between providers by changing REGISTRY_BASE_URL:
 *   R2:     https://registry.layerbase.host
 *   GitHub: https://github.com/robertjbass/hostdb/releases/download
 */

const REGISTRY_BASE_URL = 'https://registry.layerbase.host'

export function getDownloadUrl(tag: string, filename: string): string {
  return `${REGISTRY_BASE_URL}/${tag}/${filename}`
}

export function getRegistryBaseUrl(): string {
  return REGISTRY_BASE_URL
}
