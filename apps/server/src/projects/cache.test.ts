import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createScanCache } from './cache.js'
import { createProject } from './scan.js'

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
    const cache = createScanCache(join(root, 'missing'))
    const first = await cache.get()
    await createProject(join(root, 'missing'), { title: 'A', views: {} })
    cache.invalidate()
    expect((await cache.get()).projects).toHaveLength(1)
    expect(first.projects).toHaveLength(0)
  })
})
