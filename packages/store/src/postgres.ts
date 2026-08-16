import { eq } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/node-postgres'
import pg from 'pg'
import { projects } from './schema.pg.js'
import { fromRow, toRow } from './row.js'
import type { MetadataStore, ProjectRecord } from './types.js'

export function createPostgresStore(url: string): MetadataStore {
  const pool = new pg.Pool({ connectionString: url })
  const db = drizzle(pool)

  return {
    async init() {
      await pool.query(`
        CREATE TABLE IF NOT EXISTS projects (
          id TEXT PRIMARY KEY,
          title TEXT NOT NULL,
          path TEXT NOT NULL,
          tags TEXT NOT NULL DEFAULT '[]',
          views TEXT NOT NULL DEFAULT '[]',
          last_opened_at BIGINT,
          updated_at BIGINT NOT NULL
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
      await pool.end()
    },
  }
}
