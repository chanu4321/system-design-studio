import { mkdirSync, mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { ProjectManifest } from '@sd/shared'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { detectViews, loadManifest, reconcileViews, writeManifest } from './manifest.js'

const ID = '3f2504e0-4f89-41d3-9a0c-0305e82c3301'
let dir: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'sd-manifest-'))
})
afterEach(() => rmSync(dir, { recursive: true, force: true }))

describe('reconcileViews', () => {
  it('drops a declared view whose directory is absent', () => {
    const out = reconcileViews({ lld: { language: 'java' }, hld: {} }, { lld: { language: 'java' } })
    expect(out).toEqual({ lld: { language: 'java' } })
  })

  it('adopts a directory that was added by hand outside the app', () => {
    const out = reconcileViews({ lld: { language: 'java' } }, { lld: { language: 'java' }, hld: {} })
    expect(out.hld).toEqual({})
  })

  it('preserves declared metadata such as entryPoint', () => {
    const out = reconcileViews(
      { lld: { language: 'java', entryPoint: 'Main' } },
      { lld: { language: 'java' } },
    )
    expect(out.lld).toEqual({ language: 'java', entryPoint: 'Main' })
  })

  it('fills in a language detected from disk when none was declared', () => {
    const out = reconcileViews({ lld: {} }, { lld: { language: 'cpp' } })
    expect(out.lld?.language).toBe('cpp')
  })

  it('keeps the declared language when disk detection disagrees', () => {
    const out = reconcileViews({ lld: { language: 'java' } }, { lld: { language: 'cpp' } })
    expect(out.lld?.language).toBe('java')
  })

  it('returns an empty map when nothing is on disk', () => {
    expect(reconcileViews({ lld: { language: 'java' } }, {})).toEqual({})
  })
})

describe('detectViews', () => {
  it('detects no views in an empty project', async () => {
    expect(await detectViews(dir)).toEqual({})
  })

  it('detects an lld view and infers java from file extensions', async () => {
    mkdirSync(join(dir, 'lld', 'src'), { recursive: true })
    writeFileSync(join(dir, 'lld', 'src', 'Vehicle.java'), 'class Vehicle {}')
    expect(await detectViews(dir)).toEqual({ lld: { language: 'java' } })
  })

  it('infers cpp from .cpp and .h files', async () => {
    mkdirSync(join(dir, 'lld', 'src'), { recursive: true })
    writeFileSync(join(dir, 'lld', 'src', 'vehicle.cpp'), 'int main(){}')
    expect(await detectViews(dir)).toEqual({ lld: { language: 'cpp' } })
  })

  it('detects an hld view with no language', async () => {
    mkdirSync(join(dir, 'hld'), { recursive: true })
    expect(await detectViews(dir)).toEqual({ hld: {} })
  })
})

describe('loadManifest', () => {
  it('throws a ManifestError when project.json is missing', async () => {
    await expect(loadManifest(dir)).rejects.toThrow(/project.json/)
  })

  it('throws a ManifestError when project.json is malformed', async () => {
    writeFileSync(join(dir, 'project.json'), '{ not json')
    await expect(loadManifest(dir)).rejects.toThrow()
  })

  it('reconciles against disk and writes the corrected manifest back', async () => {
    mkdirSync(join(dir, 'lld', 'src'), { recursive: true })
    writeFileSync(join(dir, 'lld', 'src', 'A.java'), 'class A {}')
    writeFileSync(
      join(dir, 'project.json'),
      JSON.stringify({ id: ID, title: 'Parking Lot', views: { lld: { language: 'java' }, hld: {} } }),
    )

    const loaded = await loadManifest(dir)
    expect(loaded.views).toEqual({ lld: { language: 'java' } })

    const onDisk = JSON.parse(readFileSync(join(dir, 'project.json'), 'utf8'))
    expect(onDisk.views).toEqual({ lld: { language: 'java' } })
  })

  it('leaves project.json untouched when it already agrees with disk', async () => {
    mkdirSync(join(dir, 'lld', 'src'), { recursive: true })
    writeFileSync(join(dir, 'lld', 'src', 'A.java'), 'class A {}')
    // Annotated deliberately: without it, strict mode widens `language: 'java'`
    // to `string`, which is not assignable to `Language | undefined`.
    const manifest: ProjectManifest = {
      id: ID,
      title: 'Parking Lot',
      tags: [],
      views: { lld: { language: 'java' } },
    }
    await writeManifest(dir, manifest)
    const before = readFileSync(join(dir, 'project.json'), 'utf8')

    await loadManifest(dir)

    expect(readFileSync(join(dir, 'project.json'), 'utf8')).toBe(before)
  })
})
