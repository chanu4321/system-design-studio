import type { MetadataStore } from '@sd/store'
import Fastify, { type FastifyInstance } from 'fastify'
import type { ServerConfig } from './config.js'
import { createScanCache } from './projects/cache.js'
import { registerFileRoutes } from './routes/files.js'
import { registerProjectRoutes } from './routes/projects.js'

export async function buildApp(deps: {
  config: ServerConfig
  store: MetadataStore
}): Promise<FastifyInstance> {
  const app = Fastify({ logger: false })
  const scans = createScanCache(deps.config.projectsDir)

  // No CORS by design. The web app reaches this server through Vite's /api
  // proxy, so every request is same-origin. Enabling CORS here would expose an
  // unauthenticated file-read-and-write API to any page the user has open.

  app.get('/api/health', async () => ({ status: 'ok' }))
  registerProjectRoutes(app, { ...deps, scans })
  registerFileRoutes(app, { config: deps.config, scans })

  return app
}
