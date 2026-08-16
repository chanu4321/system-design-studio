import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll } from 'vitest'
import { describeMetadataStore } from './contract.js'
import { createSqliteStore } from './sqlite.js'

const dir = mkdtempSync(join(tmpdir(), 'sd-store-'))

describeMetadataStore('sqlite', async () => createSqliteStore(join(dir, 'test.db')))

// Removing the temp directory is housekeeping, not behaviour under test — the
// store's contract is covered entirely by the nine assertions above.
//
// The retry budget is deliberately tiny. Where the handle is released promptly,
// half a second is plenty and the directory goes away. Where it is not — Windows
// with an antivirus scanner holding a just-closed libsql file, measured past 15s
// here — no realistic budget wins that race, so a larger one only burns time on
// every single run to achieve nothing. Give up fast; the OS reclaims its own
// temp directory.
afterAll(() => {
  try {
    rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
  } catch {
    // Handle still held. Nothing to do, and nothing worth failing a suite over.
  }
})
