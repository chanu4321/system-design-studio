import { stat } from 'node:fs/promises'
import { join } from 'node:path'
import { createProjectBodySchema, type ProjectListResponse } from '@sd/shared'
import type { MetadataStore } from '@sd/store'
import type { FastifyInstance } from 'fastify'
import type { ServerConfig } from '../config.js'
import type { ScanCache } from '../projects/cache.js'
import { loadManifest } from '../projects/manifest.js'
import { createProject, type ProjectSummary } from '../projects/scan.js'

async function directoryExists(dir: string): Promise<boolean> {
  try {
    await stat(dir)
    return true
  } catch {
    return false
  }
}

async function resolveFromCache(
  deps: { config: ServerConfig; scans: ScanCache },
  id: string,
): Promise<{ summary: ProjectSummary; dir: string } | null> {
  const { projects } = await deps.scans.get()
  const summary = projects.find((p) => p.id === id)
  return summary ? { summary, dir: join(deps.config.projectsDir, summary.path) } : null
}

/**
 * Resolves a project id to its directory via the scan cache; also the 404
 * gate.
 *
 * The cache can be holding a summary for a directory that is already gone —
 * deleted outside the app since the cache was last populated. Handing that
 * stale directory to a caller is worse now than before caching existed:
 * `writeViewFile` `mkdir`s its parents, so a write would resurrect the
 * deleted project as a manifest-less fragment instead of 404ing. So a cache
 * hit is verified against disk before being trusted: if the directory is
 * gone, the cache is forced to rescan and the lookup is retried once before
 * giving up.
 */
export async function findProject(
  deps: { config: ServerConfig; scans: ScanCache },
  id: string,
): Promise<{ summary: ProjectSummary; dir: string } | null> {
  const found = await resolveFromCache(deps, id)
  if (!found) return null
  if (await directoryExists(found.dir)) return found

  // The cached summary names a directory that is no longer there. Force a
  // fresh scan and check once more before giving up.
  deps.scans.invalidate()
  const retried = await resolveFromCache(deps, id)
  return retried && (await directoryExists(retried.dir)) ? retried : null
}

/**
 * `lastOpenedAt` is passed in rather than hard-written: it is the one column
 * that is NOT derivable from disk, so re-indexing a scanned project must carry
 * the stored value forward or the column can never survive a single listing.
 */
async function index(
  store: MetadataStore,
  summary: ProjectSummary,
  lastOpenedAt: number | null,
): Promise<void> {
  await store.upsertProject({
    id: summary.id,
    title: summary.title,
    path: summary.path,
    tags: summary.tags,
    views: summary.views,
    lastOpenedAt,
    updatedAt: summary.updatedAt,
  })
}

export function registerProjectRoutes(
  app: FastifyInstance,
  deps: { config: ServerConfig; store: MetadataStore; scans: ScanCache },
): void {
  const { config, store, scans } = deps

  app.get('/api/projects', async (): Promise<ProjectListResponse> => {
    // If the projects root is unreadable, scanProjects now throws rather than
    // reporting an empty directory — which matters below, because an empty scan
    // prunes the whole index.
    const { projects, broken } = await scans.get()

    // Read the index once. It supplies both the values that must survive a
    // rescan and the row set the prune works from.
    const existing = new Map((await store.listProjects()).map((row) => [row.id, row]))

    for (const p of projects) {
      await index(store, p, existing.get(p.id)?.lastOpenedAt ?? null)
    }

    // The store is an index, not a source of truth. Drop rows whose project
    // has been deleted or moved away, so that layouts and notes added in M4
    // cannot accumulate against ids that no longer exist.
    const live = new Set(projects.map((p) => p.id))
    for (const row of existing.values()) {
      if (!live.has(row.id)) await store.deleteProject(row.id)
    }

    return { projects, broken }
  })

  app.post('/api/projects', async (req, reply) => {
    const parsed = createProjectBodySchema.safeParse(req.body)
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.message })

    const summary = await createProject(config.projectsDir, parsed.data)
    scans.invalidate()
    await index(store, summary, null) // never opened
    return reply.code(201).send(summary)
  })

  app.get('/api/projects/:id', async (req, reply) => {
    const { id } = req.params as { id: string }
    const found = await findProject({ config, scans }, id)
    if (!found) return reply.code(404).send({ error: `No project with id ${id}` })
    return loadManifest(found.dir)
  })
}
