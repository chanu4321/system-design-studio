import { describe, it, expect } from 'vitest'
import { createLocalBackend } from './local.js'
import { itWithJdk } from './test-support/toolchain.js'

describe('available', () => {
  // This test requires a JDK, exactly as the Postgres contract suite requires
  // TEST_DATABASE_URL. Without one it reports a named skip rather than
  // failing or silently passing — see test-support/toolchain.ts.
  itWithJdk('is true when javac and java resolve', async () => {
    expect(await createLocalBackend().available()).toBe(true)
  })

  it('is false when the toolchain cannot be found', async () => {
    const backend = createLocalBackend({ javac: 'definitely-not-a-real-binary' })
    expect(await backend.available()).toBe(false)
  })
})
