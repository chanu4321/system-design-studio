import { scanProjects, type ScanResult } from './scan.js'

export type ScanCache = {
  get(): Promise<ScanResult>
  invalidate(): void
}

/**
 * Memoises the project scan until something writes.
 *
 * This is a read-through snapshot, not a live view of the filesystem: between
 * this server's own writes, `get()` never touches disk. A project folder
 * deleted, edited, or added from outside this app — by hand, by another
 * process — is not reflected until this server itself calls `invalidate()`
 * (from its own POST/PUT routes) or the process restarts. A filesystem
 * watcher that closes that gap is deferred past this milestone.
 *
 * In-flight scans are shared so a burst of concurrent requests does one walk
 * rather than one each. A scan already in flight when `invalidate()` fires is
 * superseded: it still resolves normally for whoever is already awaiting it,
 * but it must not install its (now-stale) result as the cache — otherwise a
 * write landing mid-walk would go unnoticed, since the walk started before
 * the write and would resolve after `invalidate()` already ran, overwriting
 * the cache with a pre-write snapshot that then survives until the next
 * write. An `epoch` counter, bumped on every `invalidate()`, is what a
 * completing scan checks before committing to `cached`.
 *
 * `scan` is injectable, defaulting to `scanProjects`, so tests can control
 * exactly when a scan resolves — to interleave it with `invalidate()` — and
 * make it reject, which the real filesystem here cannot be coerced into on
 * demand. Both are needed to exercise the guarantees above.
 */
export function createScanCache(
  rootDir: string,
  scan: (rootDir: string) => Promise<ScanResult> = scanProjects,
): ScanCache {
  let inFlight: Promise<ScanResult> | null = null
  let cached: ScanResult | null = null
  let epoch = 0

  return {
    async get(): Promise<ScanResult> {
      if (cached) return cached
      if (inFlight) return inFlight

      const startedAtEpoch = epoch
      inFlight = scan(rootDir)
        .then((result) => {
          // Only install this result if nothing invalidated the cache while
          // this scan was in flight. A superseded scan still resolves for its
          // own caller; it just is not trusted to seed the next one.
          if (epoch === startedAtEpoch) cached = result
          return result
        })
        .finally(() => {
          inFlight = null
        })

      return inFlight
    },

    invalidate(): void {
      cached = null
      epoch++
    },
  }
}
