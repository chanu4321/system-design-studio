import { z } from 'zod'
import { viewKindSchema, viewsSchema } from './project.js'

export const createProjectBodySchema = z.object({
  title: z.string().min(1),
  views: viewsSchema.default({}),
})
export type CreateProjectBody = z.infer<typeof createProjectBodySchema>

export const writeFileBodySchema = z.object({
  path: z.string().min(1),
  content: z.string(),
})
export type WriteFileBody = z.infer<typeof writeFileBodySchema>

export const viewParamSchema = z.object({ id: z.string(), view: viewKindSchema })

export type ProjectSummaryDto = {
  id: string
  title: string
  path: string
  tags: string[]
  views: ('lld' | 'hld')[]
  updatedAt: number
}

export type ProjectListResponse = {
  projects: ProjectSummaryDto[]
  broken: { path: string; reason: string }[]
}

export type FileListResponse = { files: { path: string; size: number }[] }
export type FileContentResponse = { path: string; content: string }
