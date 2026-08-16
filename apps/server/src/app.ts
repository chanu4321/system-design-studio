import cors from '@fastify/cors'
import type { MetadataStore } from '@sd/store'
import Fastify, { type FastifyInstance } from 'fastify'
import type { ServerConfig } from './config.js'
import { registerFileRoutes } from './routes/files.js'
import { registerProjectRoutes } from './routes/projects.js'

export async function buildApp(deps: {
  config: ServerConfig
  store: MetadataStore
}): Promise<FastifyInstance> {
  const app = Fastify({ logger: false })
  await app.register(cors, { origin: true })

  app.get('/api/health', async () => ({ status: 'ok' }))
  registerProjectRoutes(app, deps)
  registerFileRoutes(app, { config: deps.config })

  return app
}
