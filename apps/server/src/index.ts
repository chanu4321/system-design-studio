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
