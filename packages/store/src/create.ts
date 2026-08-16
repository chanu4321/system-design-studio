import { createPostgresStore } from './postgres.js'
import { createSqliteStore } from './sqlite.js'
import type { MetadataStore } from './types.js'

export type StoreConfig = {
  /** When present, Postgres is used. When absent, local SQLite is used. */
  databaseUrl?: string | undefined
  sqliteFile: string
}

export function createStore(config: StoreConfig): MetadataStore {
  return config.databaseUrl
    ? createPostgresStore(config.databaseUrl)
    : createSqliteStore(config.sqliteFile)
}
