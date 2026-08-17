import { scanProjects, type ScanResult } from './scan.js'

export type ScanCache = {
  get(): Promise<ScanResult>
  invalidate(): void
}

/**
 * Memoises the project scan until something writes.
 *
 * The scan is not cheap any more: each project costs a recursive walk for
 * language detection and another for its newest modification time, and
 * `findProject` runs it on every file request. This is purely a performance
 * cache — the filesystem stays authoritative, and `invalidate()` is called
 * wherever the server changes it.
 *
 * In-flight scans are shared so a burst of concurrent requests does one walk
 * rather than one each.
 */
export function createScanCache(rootDir: string): ScanCache {
  let inFlight: Promise<ScanResult> | null = null
  let cached: ScanResult | null = null

  return {
    async get(): Promise<ScanResult> {
      if (cached) return cached
      if (inFlight) return inFlight

      inFlight = scanProjects(rootDir)
        .then((result) => {
          cached = result
          return result
        })
        .finally(() => {
          inFlight = null
        })

      return inFlight
    },

    invalidate(): void {
      cached = null
    },
  }
}
