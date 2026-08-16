import { resolve } from 'node:path'

export type ServerConfig = {
  port: number
  projectsDir: string
  sqliteFile: string
  databaseUrl?: string | undefined
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): ServerConfig {
  return {
    port: Number(env.PORT ?? 5174),
    projectsDir: resolve(env.PROJECTS_DIR ?? './projects'),
    sqliteFile: resolve(env.SQLITE_FILE ?? './data/lld.db'),
    databaseUrl: env.DATABASE_URL,
  }
}
