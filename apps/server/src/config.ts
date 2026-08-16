import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * Defaults resolve against the repository root, never the current working
 * directory. `pnpm --filter @sd/server dev` runs with cwd = `apps/server`, so a
 * cwd-relative default creates `apps/server/projects` — the wrong location, and
 * outside the tracked repo-root `projects/` the design specifies. Worse, two
 * launch styles would then address two different project directories while
 * sharing one metadata database, and the listing route's prune would delete the
 * index for whichever set was not currently visible.
 */
const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..')

export type ServerConfig = {
  port: number
  projectsDir: string
  sqliteFile: string
  databaseUrl?: string | undefined
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): ServerConfig {
  return {
    port: Number(env.PORT ?? 5174),
    projectsDir: resolve(REPO_ROOT, env.PROJECTS_DIR ?? 'projects'),
    sqliteFile: resolve(REPO_ROOT, env.SQLITE_FILE ?? 'data/lld.db'),
    databaseUrl: env.DATABASE_URL,
  }
}
