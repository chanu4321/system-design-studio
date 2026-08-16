import { readFile, readdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import {
  VIEW_KINDS,
  projectManifestSchema,
  type Language,
  type ProjectManifest,
  type ViewKind,
  type ViewMeta,
  type Views,
} from '@sd/shared'

export class ManifestError extends Error {}

const MANIFEST = 'project.json'

const EXTENSION_LANGUAGE: Record<string, Language> = {
  '.java': 'java',
  '.cpp': 'cpp',
  '.cc': 'cpp',
  '.hpp': 'cpp',
  '.h': 'cpp',
}

/**
 * Disk is authoritative (spec section 4). A declared view without its directory
 * is dropped; a directory without a declaration is adopted. Declared metadata
 * wins over detection, so a hand-set language or entryPoint is never clobbered.
 */
export function reconcileViews(declared: Views, present: Views): Views {
  const out: Views = {}
  for (const kind of VIEW_KINDS) {
    const onDisk = present[kind]
    if (!onDisk) continue
    const decl = declared[kind]
    const merged: ViewMeta = { ...onDisk, ...decl }
    if (merged.language === undefined) delete merged.language
    if (merged.entryPoint === undefined) delete merged.entryPoint
    out[kind] = merged
  }
  return out
}

async function detectLanguage(viewDir: string): Promise<Language | undefined> {
  let entries: string[]
  try {
    entries = await readdir(viewDir, { recursive: true })
  } catch {
    return undefined
  }
  for (const entry of entries) {
    const dot = entry.lastIndexOf('.')
    if (dot === -1) continue
    const lang = EXTENSION_LANGUAGE[entry.slice(dot).toLowerCase()]
    if (lang) return lang
  }
  return undefined
}

export async function detectViews(projectDir: string): Promise<Views> {
  const out: Views = {}
  let entries
  try {
    entries = await readdir(projectDir, { withFileTypes: true })
  } catch {
    return out
  }
  const dirs = new Set(entries.filter((e) => e.isDirectory()).map((e) => e.name))

  for (const kind of VIEW_KINDS) {
    if (!dirs.has(kind)) continue
    const meta: ViewMeta = {}
    if (kind === 'lld') {
      const language = await detectLanguage(join(projectDir, kind))
      if (language) meta.language = language
    }
    out[kind] = meta
  }
  return out
}

export async function writeManifest(projectDir: string, manifest: ProjectManifest): Promise<void> {
  await writeFile(join(projectDir, MANIFEST), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8')
}

export async function loadManifest(projectDir: string): Promise<ProjectManifest> {
  const file = join(projectDir, MANIFEST)

  let raw: string
  try {
    raw = await readFile(file, 'utf8')
  } catch {
    throw new ManifestError(`Missing ${MANIFEST} in ${projectDir}`)
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    throw new ManifestError(`Malformed ${MANIFEST} in ${projectDir}`)
  }

  const result = projectManifestSchema.safeParse(parsed)
  if (!result.success) {
    throw new ManifestError(`Invalid ${MANIFEST} in ${projectDir}: ${result.error.message}`)
  }

  const manifest = result.data
  const reconciled = reconcileViews(manifest.views, await detectViews(projectDir))
  const next: ProjectManifest = { ...manifest, views: reconciled }

  // Only rewrite when the reconciliation actually changed something, so that
  // merely opening a project does not dirty the user's git working tree.
  if (JSON.stringify(manifest.views) !== JSON.stringify(reconciled)) {
    await writeManifest(projectDir, next)
  }
  return next
}

export type { ViewKind }
