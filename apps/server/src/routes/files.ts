import { viewKindSchema, writeFileBodySchema } from '@sd/shared'
import type { FastifyInstance } from 'fastify'
import type { ServerConfig } from '../config.js'
import { PathEscapeError, listViewFiles, readViewFile, writeViewFile } from '../projects/files.js'
import { findProject } from './projects.js'

export function registerFileRoutes(app: FastifyInstance, deps: { config: ServerConfig }): void {
  const { config } = deps

  const resolveTarget = async (
    params: unknown,
    reply: { code: (n: number) => { send: (b: unknown) => unknown } },
  ) => {
    const { id, view } = params as { id: string; view: string }
    const parsedView = viewKindSchema.safeParse(view)
    if (!parsedView.success) {
      reply.code(400).send({ error: `Unknown view "${view}"` })
      return null
    }
    const found = await findProject(config, id)
    if (!found) {
      reply.code(404).send({ error: `No project with id ${id}` })
      return null
    }
    return { dir: found.dir, view: parsedView.data }
  }

  app.get('/api/projects/:id/views/:view/files', async (req, reply) => {
    const target = await resolveTarget(req.params, reply)
    if (!target) return
    return { files: await listViewFiles(target.dir, target.view) }
  })

  app.get('/api/projects/:id/views/:view/file', async (req, reply) => {
    const target = await resolveTarget(req.params, reply)
    if (!target) return
    const { path } = req.query as { path?: string }
    if (!path) return reply.code(400).send({ error: 'Missing path' })

    try {
      return { path, content: await readViewFile(target.dir, target.view, path) }
    } catch (err) {
      if (err instanceof PathEscapeError) return reply.code(400).send({ error: err.message })
      return reply.code(404).send({ error: `No such file: ${path}` })
    }
  })

  app.put('/api/projects/:id/views/:view/file', async (req, reply) => {
    const target = await resolveTarget(req.params, reply)
    if (!target) return
    const parsed = writeFileBodySchema.safeParse(req.body)
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.message })

    try {
      await writeViewFile(target.dir, target.view, parsed.data.path, parsed.data.content)
      return reply.code(204).send()
    } catch (err) {
      if (err instanceof PathEscapeError) return reply.code(400).send({ error: err.message })
      throw err
    }
  })
}
