import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createSqliteStore, type MetadataStore } from '@sd/store'
import type { FastifyInstance } from 'fastify'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { buildApp } from './app.js'

let dir: string
let app: FastifyInstance
let store: MetadataStore

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), 'sd-app-'))
  store = createSqliteStore(join(dir, 'data', 'test.db'))
  await store.init()
  app = await buildApp({
    config: { port: 0, projectsDir: join(dir, 'projects'), sqliteFile: join(dir, 'data', 'test.db') },
    store,
  })
})

afterEach(async () => {
  await app.close()
  // Each test closes the store it opened. Without this the suite abandons one
  // unclosed libsql handle per test — see packages/store/src/contract.ts:25-31
  // for the same rule applied there.
  await store.close()
  // Closing the store is necessary but not sufficient on Windows: the just-closed
  // sqlite client can hold its file handle a beat longer than store.close() takes
  // to resolve. No retry budget here: measured never to win this race on this
  // platform — a 100/200/300/400/500ms backoff was exhausted on every single
  // test (128 leaked sd-app-* dirs in %TEMP%, ~1.55s added per test, ~24s per
  // suite run, for zero successful retries). Cleanup is a single best-effort
  // attempt; the OS reclaims its own temp directory. See
  // packages/store/src/sqlite.test.ts:21-27 for the same non-fatal cleanup.
  try {
    rmSync(dir, { recursive: true, force: true, maxRetries: 0 })
  } catch {
    // Handle still held. Nothing to do, and nothing worth failing a suite over.
  }
})

const create = (title: string) =>
  app.inject({
    method: 'POST',
    url: '/api/projects',
    payload: { title, views: { lld: { language: 'java' } } },
  })

describe('health', () => {
  it('reports ok', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/health' })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ status: 'ok' })
  })
})

describe('projects', () => {
  it('lists nothing before anything is created', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/projects' })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ projects: [], broken: [] })
  })

  it('creates a project and returns it in the list', async () => {
    const created = await create('Parking Lot')
    expect(created.statusCode).toBe(201)
    expect(created.json().title).toBe('Parking Lot')

    const list = await app.inject({ method: 'GET', url: '/api/projects' })
    expect(list.json().projects).toHaveLength(1)
  })

  it('rejects a create with an empty title', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/projects', payload: { title: '' } })
    expect(res.statusCode).toBe(400)
  })

  it('indexes the created project into the metadata store', async () => {
    const created = await create('Parking Lot')
    const res = await app.inject({ method: 'GET', url: `/api/projects/${created.json().id}` })
    expect(res.statusCode).toBe(200)
    expect(res.json().title).toBe('Parking Lot')
  })

  it('returns 404 for an unknown project', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/projects/does-not-exist' })
    expect(res.statusCode).toBe(404)
  })

  it('prunes index rows for a project deleted from disk', async () => {
    const created = await create('Parking Lot')
    await app.inject({ method: 'GET', url: '/api/projects' })

    rmSync(join(dir, 'projects', created.json().path), { recursive: true, force: true })

    const list = await app.inject({ method: 'GET', url: '/api/projects' })
    expect(list.json().projects).toEqual([])

    const gone = await app.inject({ method: 'GET', url: `/api/projects/${created.json().id}` })
    expect(gone.statusCode).toBe(404)
  })

  it('preserves lastOpenedAt across a rescan', async () => {
    const id = (await create('Parking Lot')).json().id
    await app.inject({ method: 'GET', url: '/api/projects' })

    const row = await store.getProject(id)
    await store.upsertProject({ ...row!, lastOpenedAt: 1_700_000_000_000 })

    await app.inject({ method: 'GET', url: '/api/projects' })
    expect((await store.getProject(id))?.lastOpenedAt).toBe(1_700_000_000_000)
  })
})

describe('files', () => {
  it('lists an empty view, writes a file, then reads it back', async () => {
    const id = (await create('Parking Lot')).json().id

    const empty = await app.inject({ method: 'GET', url: `/api/projects/${id}/views/lld/files` })
    expect(empty.json()).toEqual({ files: [] })

    const write = await app.inject({
      method: 'PUT',
      url: `/api/projects/${id}/views/lld/file`,
      payload: { path: 'src/Vehicle.java', content: 'class Vehicle {}' },
    })
    expect(write.statusCode).toBe(204)

    const list = await app.inject({ method: 'GET', url: `/api/projects/${id}/views/lld/files` })
    expect(list.json().files.map((f: { path: string }) => f.path)).toEqual(['src/Vehicle.java'])

    const read = await app.inject({
      method: 'GET',
      url: `/api/projects/${id}/views/lld/file?path=src/Vehicle.java`,
    })
    expect(read.json()).toEqual({
      path: 'src/Vehicle.java',
      content: 'class Vehicle {}',
      mtimeMs: expect.any(Number),
    })
  })

  it('returns 400 for a path that escapes the view', async () => {
    const id = (await create('Parking Lot')).json().id
    const res = await app.inject({
      method: 'GET',
      url: `/api/projects/${id}/views/lld/file?path=${encodeURIComponent('../../escape.txt')}`,
    })
    expect(res.statusCode).toBe(400)
  })

  it('returns 404 for a file that does not exist', async () => {
    const id = (await create('Parking Lot')).json().id
    const res = await app.inject({
      method: 'GET',
      url: `/api/projects/${id}/views/lld/file?path=src/Missing.java`,
    })
    expect(res.statusCode).toBe(404)
  })

  it('returns 400 for an unknown view kind', async () => {
    const id = (await create('Parking Lot')).json().id
    const res = await app.inject({ method: 'GET', url: `/api/projects/${id}/views/nope/files` })
    expect(res.statusCode).toBe(400)
  })

  it('returns 404 for a file request against an unknown project', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/projects/nope/views/lld/files' })
    expect(res.statusCode).toBe(404)
  })

  it('prefers 400 over 404 when both the view and the project are bad', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/projects/nope/views/bogus/files' })
    expect(res.statusCode).toBe(400)
  })

  it('returns 400 when writing to a path that escapes the view', async () => {
    const id = (await create('Parking Lot')).json().id
    const res = await app.inject({
      method: 'PUT',
      url: `/api/projects/${id}/views/lld/file`,
      payload: { path: '../../escape.java', content: 'x' },
    })
    expect(res.statusCode).toBe(400)
  })

  it('returns 400 when the path query parameter is repeated', async () => {
    const id = (await create('Parking Lot')).json().id
    const res = await app.inject({
      method: 'GET',
      url: `/api/projects/${id}/views/lld/file?path=a.java&path=b.java`,
    })
    expect(res.statusCode).toBe(400)
  })

  it('returns 409 when writing a file that changed on disk', async () => {
    const id = (await create('Parking Lot')).json().id
    await app.inject({
      method: 'PUT',
      url: `/api/projects/${id}/views/lld/file`,
      payload: { path: 'src/Vehicle.java', content: 'v1' },
    })
    const read = await app.inject({
      method: 'GET',
      url: `/api/projects/${id}/views/lld/file?path=src/Vehicle.java`,
    })
    const stale = read.json().mtimeMs

    await new Promise((r) => setTimeout(r, 20))
    await app.inject({
      method: 'PUT',
      url: `/api/projects/${id}/views/lld/file`,
      payload: { path: 'src/Vehicle.java', content: 'from elsewhere' },
    })

    const res = await app.inject({
      method: 'PUT',
      url: `/api/projects/${id}/views/lld/file`,
      payload: { path: 'src/Vehicle.java', content: 'v2', expectedMtimeMs: stale },
    })
    expect(res.statusCode).toBe(409)
  })

  it('returns 415 for an unsupported file type', async () => {
    const id = (await create('Parking Lot')).json().id
    const res = await app.inject({
      method: 'PUT',
      url: `/api/projects/${id}/views/lld/file`,
      payload: { path: 'src/lib.jar', content: 'x' },
    })
    expect(res.statusCode).toBe(415)
  })
})
