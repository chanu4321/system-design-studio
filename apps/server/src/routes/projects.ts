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

async function index(store: MetadataStore, summary: ProjectSummary): Promise<void> {
  await store.upsertProject({
    id: summary.id,
    title: summary.title,
    path: summary.path,
    tags: summary.tags,
    views: summary.views,
    lastOpenedAt: null,
    updatedAt: summary.updatedAt,
  })
}

export function registerProjectRoutes(
  app: FastifyInstance,
  deps: { config: ServerConfig; store: MetadataStore },
): void {
  const { config, store } = deps

  app.get('/api/projects', async (): Promise<ProjectListResponse> => {
    const { projects, broken } = await scanProjects(config.projectsDir)
    for (const p of projects) await index(store, p)

    // The store is an index, not a source of truth. Drop rows whose project
    // has been deleted or moved away, so that layouts and notes added in M4
    // cannot accumulate against ids that no longer exist.
    const live = new Set(projects.map((p) => p.id))
    for (const row of await store.listProjects()) {
      if (!live.has(row.id)) await store.deleteProject(row.id)
    }

    return { projects, broken }
  })

  app.post('/api/projects', async (req, reply) => {
    const parsed = createProjectBodySchema.safeParse(req.body)
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.message })

    const summary = await createProject(config.projectsDir, parsed.data)
    await index(store, summary)
    return reply.code(201).send(summary)
  })

  app.get('/api/projects/:id', async (req, reply) => {
    const { id } = req.params as { id: string }
    const found = await findProject(config, id)
    if (!found) return reply.code(404).send({ error: `No project with id ${id}` })
    return loadManifest(found.dir)
  })
}
