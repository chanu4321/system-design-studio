import type { ViewKind } from '@sd/shared'
import type { ProjectRecord } from './types.js'

export type ProjectRowShape = {
  id: string
  title: string
  path: string
  tags: string
  views: string
  lastOpenedAt: number | null
  updatedAt: number
}

export function toRow(rec: ProjectRecord): ProjectRowShape {
  return {
    id: rec.id,
    title: rec.title,
    path: rec.path,
    tags: JSON.stringify(rec.tags),
    views: JSON.stringify(rec.views),
    lastOpenedAt: rec.lastOpenedAt,
    updatedAt: rec.updatedAt,
  }
}

export function fromRow(row: ProjectRowShape): ProjectRecord {
  return {
    id: row.id,
    title: row.title,
    path: row.path,
    tags: JSON.parse(row.tags) as string[],
    views: JSON.parse(row.views) as ViewKind[],
    lastOpenedAt: row.lastOpenedAt,
    updatedAt: row.updatedAt,
  }
}
