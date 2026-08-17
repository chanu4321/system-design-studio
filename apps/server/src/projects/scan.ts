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

/** Skipped when computing a project's newest mtime — build output is not user edits. */
const IGNORED_DIRS = new Set(['.git', 'node_modules', 'out', 'build', 'target', 'bin', 'obj'])

/**
 * Windows resolves paths against a 260-character limit by default. The project
 * directory is only the middle of the eventual path — `lld/src/<file>.java` and
 * the projects root sit either side of it — so an uncapped slug from a pasted
 * title turns into a raw ENOENT from deep inside mkdir.
 */
const MAX_SLUG_LENGTH = 60

export function slugify(title: string): string {
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, MAX_SLUG_LENGTH)
    .replace(/-+$/, '') // truncation can land mid-separator
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

/**
 * Claims a directory by creating it, rather than checking whether it is free and
 * creating it afterwards.
 *
 * `mkdir` with `recursive: true` succeeds silently on a directory that already
 * exists, so a check-then-act pair lets two concurrent creates resolve the same
 * slug — and the second then overwrites the first project's manifest. A
 * non-recursive `mkdir` fails with EEXIST instead, which makes claiming the name
 * and testing it the same indivisible step.
 */
async function claimProjectDir(
  rootDir: string,
  base: string,
): Promise<{ path: string; dir: string }> {
  for (let n = 1; n < 1000; n++) {
    const path = n === 1 ? base : `${base}-${n}`
    const dir = join(rootDir, path)
    try {
      await mkdir(dir)
      return { path, dir }
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err
    }
  }
  throw new Error(`Could not find a free directory name for "${base}"`)
}

/**
 * Newest mtime among the project's own files.
 *
 * A directory stat cannot answer this: overwriting a file's contents leaves
 * every ancestor directory's mtime untouched, and creating one bumps only its
 * immediate parent. Editing existing source is this app's central workflow, so
 * reading `projectDir`'s mtime would leave "last edited" frozen at creation.
 *
 * The walk is bounded by project size; the wider cost of running it on every
 * request is addressed by memoising the whole scan (see `cache.ts`), not by
 * making the database authoritative.
 */
async function newestMtime(root: string): Promise<number> {
  let newest = (await stat(root)).mtimeMs

  let entries
  try {
    entries = await readdir(root, { withFileTypes: true })
  } catch {
    return newest
  }

  for (const entry of entries) {
    const child = join(root, entry.name)
    if (entry.isDirectory()) {
      if (IGNORED_DIRS.has(entry.name)) continue
      newest = Math.max(newest, await newestMtime(child))
    } else if (entry.isFile()) {
      newest = Math.max(newest, (await stat(child)).mtimeMs)
    }
  }
  return newest
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
  const { path, dir: projectDir } = await claimProjectDir(rootDir, slugify(input.title))

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
  } catch (err) {
    // A projects root that does not exist yet is genuinely empty. Anything else
    // — EACCES, EMFILE — must not masquerade as "no projects", because the
    // listing route prunes the metadata index against this result.
    const code = (err as NodeJS.ErrnoException).code
    if (code === 'ENOENT' || code === 'ENOTDIR') return result
    throw err
  }

  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    const projectDir = join(rootDir, entry.name)
    if (!(await exists(join(projectDir, 'project.json')))) continue

    try {
      const manifest = await loadManifest(projectDir)
      result.projects.push(summarise(manifest, entry.name, await newestMtime(projectDir)))
    } catch (err) {
      result.broken.push({ path: entry.name, reason: (err as Error).message })
    }
  }

  return result
}
