import { randomUUID } from 'node:crypto'
import { mkdir, readdir, stat } from 'node:fs/promises'
import { join } from 'node:path'
import type { ProjectManifest, ViewKind, Views } from '@sd/shared'
import { VIEW_KINDS } from '@sd/shared'
import { loadManifest, writeManifest } from './manifest.js'

export type ProjectSummary = {
  id: string
  title: string
  path: string
  tags: string[]
  views: ViewKind[]
  updatedAt: number
}

export type ScanResult = {
  projects: ProjectSummary[]
  broken: { path: string; reason: string }[]
}

export function slugify(title: string): string {
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return slug || 'project'
}

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path)
    return true
  } catch {
    return false
  }
}

async function uniqueSlug(rootDir: string, base: string): Promise<string> {
  if (!(await exists(join(rootDir, base)))) return base
  for (let n = 2; n < 1000; n++) {
    const candidate = `${base}-${n}`
    if (!(await exists(join(rootDir, candidate)))) return candidate
  }
  throw new Error(`Could not find a free directory name for "${base}"`)
}

function summarise(manifest: ProjectManifest, path: string, updatedAt: number): ProjectSummary {
  return {
    id: manifest.id,
    title: manifest.title,
    path,
    tags: manifest.tags,
    views: VIEW_KINDS.filter((k) => manifest.views[k] !== undefined),
    updatedAt,
  }
}

export async function createProject(
  rootDir: string,
  input: { title: string; views: Views },
): Promise<ProjectSummary> {
  await mkdir(rootDir, { recursive: true })
  const path = await uniqueSlug(rootDir, slugify(input.title))
  const projectDir = join(rootDir, path)
  await mkdir(projectDir, { recursive: true })

  for (const kind of VIEW_KINDS) {
    if (input.views[kind] === undefined) continue
    // An lld view holds source, so it gets src/. An hld view holds a spec file.
    await mkdir(kind === 'lld' ? join(projectDir, kind, 'src') : join(projectDir, kind), {
      recursive: true,
    })
  }

  const manifest: ProjectManifest = {
    id: randomUUID(),
    title: input.title,
    tags: [],
    views: input.views,
  }
  await writeManifest(projectDir, manifest)
  return summarise(manifest, path, Date.now())
}

export async function scanProjects(rootDir: string): Promise<ScanResult> {
  const result: ScanResult = { projects: [], broken: [] }

  let entries
  try {
    entries = await readdir(rootDir, { withFileTypes: true })
  } catch {
    return result
  }

  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    const projectDir = join(rootDir, entry.name)
    if (!(await exists(join(projectDir, 'project.json')))) continue

    try {
      const manifest = await loadManifest(projectDir)
      const info = await stat(projectDir)
      result.projects.push(summarise(manifest, entry.name, info.mtimeMs))
    } catch (err) {
      result.broken.push({ path: entry.name, reason: (err as Error).message })
    }
  }

  return result
}
