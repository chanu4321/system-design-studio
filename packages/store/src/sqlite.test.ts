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
// No retry budget: measured never to win this race on this platform. Windows
// with an antivirus scanner holding a just-closed libsql file kept the handle
// past 15s, and a 100/200/300/400/500ms backoff never once succeeded — it only
// burned ~1.5s per test for nothing. Cleanup is a single best-effort attempt;
// the OS reclaims its own temp directory regardless.
afterAll(() => {
  try {
    rmSync(dir, { recursive: true, force: true, maxRetries: 0 })
  } catch {
    // Handle still held. Nothing to do, and nothing worth failing a suite over.
  }
})
