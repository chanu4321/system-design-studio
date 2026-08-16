import { createClient, type Client } from '@libsql/client'
import { eq } from 'drizzle-orm'
import { drizzle, type LibSQLDatabase } from 'drizzle-orm/libsql'
import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { pathToFileURL } from 'node:url'
import { projects } from './schema.sqlite.js'
import type { MetadataStore, ProjectRecord } from './types.js'
import { fromRow, toRow } from './row.js'

export function createSqliteStore(file: string): MetadataStore {
  mkdirSync(dirname(file), { recursive: true })
  // pathToFileURL keeps Windows paths containing spaces and drive letters valid.
  const client: Client = createClient({ url: pathToFileURL(file).href })
  const db: LibSQLDatabase = drizzle(client)

  return {
    async init() {
      await client.execute(`
        CREATE TABLE IF NOT EXISTS projects (
          id TEXT PRIMARY KEY,
          title TEXT NOT NULL,
          path TEXT NOT NULL,
          tags TEXT NOT NULL DEFAULT '[]',
          views TEXT NOT NULL DEFAULT '[]',
          last_opened_at INTEGER,
          updated_at INTEGER NOT NULL
        )
      `)
    },

    async upsertProject(rec: ProjectRecord) {
      const row = toRow(rec)
      await db.insert(projects).values(row).onConflictDoUpdate({ target: projects.id, set: row })
    },

    async listProjects() {
      return (await db.select().from(projects)).map(fromRow)
    },

    async getProject(id: string) {
      const rows = await db.select().from(projects).where(eq(projects.id, id)).limit(1)
      return rows[0] ? fromRow(rows[0]) : null
    },

    async deleteProject(id: string) {
      await db.delete(projects).where(eq(projects.id, id))
    },

    async close() {
      client.close()
    },
  }
}
