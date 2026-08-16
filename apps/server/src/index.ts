import { createStore } from '@sd/store'
import { config as loadEnv } from 'dotenv'
import { fileURLToPath } from 'node:url'
import { buildApp } from './app.js'
import { loadConfig } from './config.js'

// Reads the git-ignored .env at the repository root, so DATABASE_URL never
// has to be set in a shell.
loadEnv({ path: fileURLToPath(new URL('../../../.env', import.meta.url)) })

const config = loadConfig()
const store = createStore({ databaseUrl: config.databaseUrl, sqliteFile: config.sqliteFile })
await store.init()

const app = await buildApp({ config, store })
await app.listen({ port: config.port, host: '127.0.0.1' })

console.log(`server listening on http://127.0.0.1:${config.port}`)
console.log(`projects directory: ${config.projectsDir}`)
console.log(`metadata store: ${config.databaseUrl ? 'postgres' : config.sqliteFile}`)

// The composition root created the store, so the composition root closes it.
// buildApp deliberately does not, since it did not create it — that is what
// keeps it injectable for the integration tests.
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    void (async () => {
      await app.close()
      await store.close()
      process.exit(0)
    })()
  })
}
