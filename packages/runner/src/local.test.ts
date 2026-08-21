import { describe, it, expect } from 'vitest'
import { createLocalBackend } from './local.js'

describe('available', () => {
  it('is true when javac and java resolve', async () => {
    // This suite requires a JDK, exactly as the Postgres contract suite requires
    // TEST_DATABASE_URL. It reports rather than silently passing.
    expect(await createLocalBackend().available()).toBe(true)
  })

  it('is false when the toolchain cannot be found', async () => {
    const backend = createLocalBackend({ javac: 'definitely-not-a-real-binary' })
    expect(await backend.available()).toBe(false)
  })
})
