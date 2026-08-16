import type { ViewKind } from '@sd/shared'

export type ProjectRecord = {
  id: string
  title: string
  /** Directory name relative to the projects root. */
  path: string
  tags: string[]
  views: ViewKind[]
  lastOpenedAt: number | null
  updatedAt: number
}

export interface MetadataStore {
  /** Idempotent. Creates tables if absent. Safe to call repeatedly. */
  init(): Promise<void>
  upsertProject(rec: ProjectRecord): Promise<void>
  listProjects(): Promise<ProjectRecord[]>
  getProject(id: string): Promise<ProjectRecord | null>
  deleteProject(id: string): Promise<void>
  close(): Promise<void>
}
