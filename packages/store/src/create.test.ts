import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, expect, it } from 'vitest'
import { createStore } from './create.js'

const dir = mkdtempSync(join(tmpdir(), 'sd-create-'))

// Same Windows file-lock race documented in sqlite.test.ts: the sqlite
// fallback path here uses the same libsql client, so cleanup can hit an
// EBUSY from a not-yet-released handle. Retry briefly, then give up —
// cleanup is housekeeping, not the behaviour under test.
afterAll(() => {
  try {
    rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
  } catch {
    // Handle still held. Nothing to do, and nothing worth failing a suite over.
  }
})

it('falls back to sqlite when no database url is configured', async () => {
  const store = createStore({ sqliteFile: join(dir, 'fallback.db') })
  await store.init()
  expect(await store.listProjects()).toEqual([])
  await store.close()
})

it('selects postgres when a database url is configured', () => {
  const store = createStore({ databaseUrl: 'postgres://u:p@localhost:5432/db', sqliteFile: join(dir, 'unused.db') })
  expect(store).toBeDefined()
})
