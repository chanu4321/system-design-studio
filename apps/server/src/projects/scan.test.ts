import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createProject, scanProjects, slugify } from './scan.js'

let root: string
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'sd-scan-'))
})
afterEach(() => rmSync(root, { recursive: true, force: true }))

describe('slugify', () => {
  it('lowercases and hyphenates', () => {
    expect(slugify('Parking Lot')).toBe('parking-lot')
  })
  it('strips punctuation and collapses separators', () => {
    expect(slugify('Splitwise!! (v2)')).toBe('splitwise-v2')
  })
  it('falls back to "project" when nothing survives', () => {
    expect(slugify('!!!')).toBe('project')
  })
  it('caps the slug length so Windows paths stay under the limit', () => {
    expect(slugify('a'.repeat(200)).length).toBeLessThanOrEqual(60)
  })
  it('does not leave a trailing hyphen when truncation lands on a separator', () => {
    // 59 characters then a space: a naive slice would end on the separator.
    expect(slugify(`${'a'.repeat(59)} bcdef`).endsWith('-')).toBe(false)
  })
})

describe('createProject', () => {
  it('creates the directory, manifest, and view folders', async () => {
    const summary = await createProject(root, {
      title: 'Parking Lot',
      views: { lld: { language: 'java' } },
    })
    expect(summary.path).toBe('parking-lot')
    expect(summary.id).toMatch(/^[0-9a-f-]{36}$/)
    expect(existsSync(join(root, 'parking-lot', 'project.json'))).toBe(true)
    expect(existsSync(join(root, 'parking-lot', 'lld', 'src'))).toBe(true)
  })

  it('creates an hld view without a src subfolder', async () => {
    await createProject(root, { title: 'URL Shortener', views: { hld: {} } })
    expect(existsSync(join(root, 'url-shortener', 'hld'))).toBe(true)
    expect(existsSync(join(root, 'url-shortener', 'hld', 'src'))).toBe(false)
  })

  it('creates both views when both are requested', async () => {
    const s = await createProject(root, {
      title: 'Splitwise',
      views: { lld: { language: 'java' }, hld: {} },
    })
    expect(s.views.sort()).toEqual(['hld', 'lld'])
  })

  it('suffixes the slug rather than overwriting an existing project', async () => {
    await createProject(root, { title: 'Parking Lot', views: { lld: { language: 'java' } } })
    const second = await createProject(root, { title: 'Parking Lot', views: { lld: { language: 'java' } } })
    expect(second.path).toBe('parking-lot-2')
  })

  it('gives each project a distinct id', async () => {
    const a = await createProject(root, { title: 'A', views: {} })
    const b = await createProject(root, { title: 'B', views: {} })
    expect(a.id).not.toBe(b.id)
  })

  it('creates a project from a very long title without blowing the path limit', async () => {
    const summary = await createProject(root, {
      title: 'Parking Lot '.repeat(40),
      views: { lld: { language: 'java' } },
    })
    expect(summary.path.length).toBeLessThanOrEqual(60)
    expect(existsSync(join(root, summary.path, 'lld', 'src'))).toBe(true)
  })

  it('gives concurrent creates of the same title distinct directories', async () => {
    const [a, b] = await Promise.all([
      createProject(root, { title: 'Parking Lot', views: {} }),
      createProject(root, { title: 'Parking Lot', views: {} }),
    ])
    expect(a.path).not.toBe(b.path)
    expect(a.id).not.toBe(b.id)
    // Neither create may have overwritten the other's manifest.
    expect((await scanProjects(root)).projects).toHaveLength(2)
  })
})

describe('scanProjects', () => {
  it('returns nothing for an empty root', async () => {
    expect(await scanProjects(root)).toEqual({ projects: [], broken: [] })
  })

  it('finds created projects', async () => {
    await createProject(root, { title: 'Parking Lot', views: { lld: { language: 'java' } } })
    await createProject(root, { title: 'Splitwise', views: { lld: { language: 'java' } } })
    const { projects } = await scanProjects(root)
    expect(projects.map((p) => p.title).sort()).toEqual(['Parking Lot', 'Splitwise'])
  })

  it('ignores directories that have no manifest', async () => {
    mkdirSync(join(root, 'not-a-project'), { recursive: true })
    expect((await scanProjects(root)).projects).toEqual([])
  })

  it('reports a malformed project as broken instead of failing the whole scan', async () => {
    await createProject(root, { title: 'Good', views: {} })
    mkdirSync(join(root, 'bad'), { recursive: true })
    writeFileSync(join(root, 'bad', 'project.json'), '{ not json')

    const { projects, broken } = await scanProjects(root)
    expect(projects).toHaveLength(1)
    expect(broken).toHaveLength(1)
    expect(broken[0]?.path).toBe('bad')
  })

  it('returns nothing for a root directory that does not exist', async () => {
    expect(await scanProjects(join(root, 'no-such-dir'))).toEqual({ projects: [], broken: [] })
  })

  it('advances updatedAt when a source file is added after creation', async () => {
    const created = await createProject(root, {
      title: 'Parking Lot',
      views: { lld: { language: 'java' } },
    })
    const before = (await scanProjects(root)).projects[0]?.updatedAt ?? 0

    await new Promise((resolve) => setTimeout(resolve, 20))
    writeFileSync(join(root, created.path, 'lld', 'src', 'Vehicle.java'), 'class Vehicle {}')

    const after = (await scanProjects(root)).projects[0]?.updatedAt ?? 0
    expect(after).toBeGreaterThan(before)
  })
})
