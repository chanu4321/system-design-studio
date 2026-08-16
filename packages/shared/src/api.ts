import { z } from 'zod'
import { viewsSchema, type ViewKind } from './project.js'

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

export type ProjectSummaryDto = {
  id: string
  title: string
  path: string
  tags: string[]
  views: ViewKind[]
  updatedAt: number
}

export type ProjectListResponse = {
  projects: ProjectSummaryDto[]
  broken: { path: string; reason: string }[]
}

export type FileEntry = { path: string; size: number }

export type FileListResponse = { files: FileEntry[] }
export type FileContentResponse = { path: string; content: string }
