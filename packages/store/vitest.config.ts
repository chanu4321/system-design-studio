import { config } from 'dotenv'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

config({ path: fileURLToPath(new URL('../../.env', import.meta.url)) })

export default defineConfig({
  test: { environment: 'node' },
})
