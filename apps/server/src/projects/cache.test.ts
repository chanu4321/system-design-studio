import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createScanCache } from './cache.js'
import { createProject, scanProjects, type ScanResult } from './scan.js'

let root: string
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'sd-cache-'))
})
afterEach(() => {
  try {
    rmSync(root, { recursive: true, force: true, maxRetries: 0 })
  } catch {
    // Best effort; the OS reclaims its own temp directory.
  }
})

describe('createScanCache', () => {
  it('returns the same result without rescanning', async () => {
    await createProject(root, { title: 'A', views: {} })
    const cache = createScanCache(root)

    const first = await cache.get()
    // Created behind the cache's back: a cached read must not see it.
    await createProject(root, { title: 'B', views: {} })
    const second = await cache.get()

    expect(first.projects).toHaveLength(1)
    expect(second.projects).toHaveLength(1)
  })

  it('rescans after invalidate', async () => {
    await createProject(root, { title: 'A', views: {} })
    const cache = createScanCache(root)
    await cache.get()

    await createProject(root, { title: 'B', views: {} })
    cache.invalidate()

    expect((await cache.get()).projects).toHaveLength(2)
  })

  it('scans once when several callers race', async () => {
    await createProject(root, { title: 'A', views: {} })
    const cache = createScanCache(root)

    const [a, b, c] = await Promise.all([cache.get(), cache.get(), cache.get()])
    expect(a).toBe(b)
    expect(b).toBe(c)
  })

  it('does not cache a failed scan', async () => {
    // scanProjects itself can't be made to reject on demand from here — a
    // missing root is a legitimate empty result, not a rejection — so the
    // injected scan function is what actually produces the failure.
    await createProject(root, { title: 'A', views: {} })
    let callCount = 0
    const scan = (dir: string): Promise<ScanResult> => {
      callCount++
      return callCount === 1 ? Promise.reject(new Error('scan boom')) : scanProjects(dir)
    }
    const cache = createScanCache(root, scan)

    await expect(cache.get()).rejects.toThrow('scan boom')

    // The rejection must not have been cached: the next get() scans for real
    // and finds the project that was there all along.
    expect((await cache.get()).projects).toHaveLength(1)
  })

  it('discards a scan superseded by an invalidate that lands before it resolves', async () => {
    await createProject(root, { title: 'A', views: {} })
    // What the in-flight scan below "saw": the world before B existed.
    const staleResult = await scanProjects(root)

    let resolveFirstScan!: (result: ScanResult) => void
    const firstScan = new Promise<ScanResult>((resolve) => {
      resolveFirstScan = resolve
    })
    let callCount = 0
    const scan = (dir: string): Promise<ScanResult> => {
      callCount++
      return callCount === 1 ? firstScan : scanProjects(dir)
    }

    const cache = createScanCache(root, scan)
    const pending = cache.get() // starts the controllable scan; it does not resolve yet

    // A write races the in-flight scan: it completes, and its invalidate()
    // fires, before the scan — which started before the write — resolves.
    await createProject(root, { title: 'B', views: {} })
    cache.invalidate()

    // The superseded scan now resolves with what it saw before the write.
    resolveFirstScan(staleResult)

    // Its own caller still gets that result: a scan does not fail just
    // because it was superseded.
    expect((await pending).projects).toHaveLength(1)

    // But the cache itself must not have been poisoned with it — the next
    // get() has to do a real rescan and see the write.
    expect((await cache.get()).projects).toHaveLength(2)
  })

  it('does not re-scan forever when a scan itself rewrites a manifest', async () => {
    // A declared view whose directory does not exist forces loadManifest to
    // rewrite project.json *during* the walk — the exact condition the trap
    // needs. If that rewrite invalidated the cache (bumping the epoch
    // mid-scan), the completing scan would refuse to install its result and
    // the next get() would walk again, forever.
    const created = await createProject(root, { title: 'A', views: { lld: {} } })
    const projectDir = join(root, created.path)
    rmSync(join(projectDir, 'lld'), { recursive: true, force: true })

    // Exercises the real scanProjects -> loadManifest -> writeManifest path.
    // Wrapped only to count actual walks; a bare stub would never reach
    // loadManifest and so could never trip on this trap.
    let walks = 0
    const countingScan = async (dir: string): Promise<ScanResult> => {
      walks++
      return scanProjects(dir)
    }
    const cache = createScanCache(root, countingScan)

    await cache.get()
    await cache.get()

    expect(walks).toBe(1)

    // Proves the rewrite actually happened during the walk, rather than this
    // setup quietly being a no-op.
    const manifest = JSON.parse(readFileSync(join(projectDir, 'project.json'), 'utf8'))
    expect(manifest.views.lld).toBeUndefined()
  })
})
