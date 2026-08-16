import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll } from 'vitest'
import { describeMetadataStore } from './contract.js'
import { createSqliteStore } from './sqlite.js'

const dir = mkdtempSync(join(tmpdir(), 'sd-store-'))

describeMetadataStore('sqlite', async () => createSqliteStore(join(dir, 'test.db')))

// On Windows, @libsql/client's native binding doesn't release its file
// handle synchronously when close() returns — the OS-level unlock happens on
// a background thread whose timing is unpredictable and, empirically, has no
// bound that's both reliable and cheap: it ranged from well under a second to
// upward of ten seconds across otherwise-identical runs in the same session
// (consistent with antivirus scanning each newly-written db file, worse the
// more files are created in a short window). This is best-effort tidying of
// a throwaway OS temp directory, not part of the store's behaviour under
// test: retry briefly to catch the common fast case, but never fail the
// suite over it — on persistent EBUSY the OS reclaims the temp dir on its
// own, so give up quietly rather than stall every run for the slow case.
afterAll(async () => {
  for (let attempt = 1; attempt <= 20; attempt++) {
    try {
      rmSync(dir, { recursive: true, force: true })
      return
    } catch (err) {
      const busy = err instanceof Error && 'code' in err && err.code === 'EBUSY'
      if (!busy) throw err
      await new Promise((r) => setTimeout(r, 100))
    }
  }
})
