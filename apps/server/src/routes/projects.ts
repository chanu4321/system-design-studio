import { createProjectBodySchema, type ProjectListResponse } from '@sd/shared'
import type { MetadataStore } from '@sd/store'
import type { FastifyInstance } from 'fastify'
import type { ServerConfig } from '../config.js'
import { loadManifest } from '../projects/manifest.js'
import { createProject, scanProjects, type ProjectSummary } from '../projects/scan.js'
import { join } from 'node:path'

/** Resolves a project id to its directory by scanning; also the 404 gate. */
export async function findProject(
  config: ServerConfig,
  id: string,
): Promise<{ summary: ProjectSummary; dir: string } | null> {
  const { projects } = await scanProjects(config.projectsDir)
  const summary = projects.find((p) => p.id === id)
  return summary ? { summary, dir: join(config.projectsDir, summary.path) } : null
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
  deps: { config: ServerConfig; store: MetadataStore },
): void {
  const { config, store } = deps

  app.get('/api/projects', async (): Promise<ProjectListResponse> => {
    // If the projects root is unreadable, scanProjects now throws rather than
    // reporting an empty directory — which matters below, because an empty scan
    // prunes the whole index.
    const { projects, broken } = await scanProjects(config.projectsDir)

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
    await index(store, summary, null) // never opened
    return reply.code(201).send(summary)
  })

  app.get('/api/projects/:id', async (req, reply) => {
    const { id } = req.params as { id: string }
    const found = await findProject(config, id)
    if (!found) return reply.code(404).send({ error: `No project with id ${id}` })
    return loadManifest(found.dir)
  })
}
