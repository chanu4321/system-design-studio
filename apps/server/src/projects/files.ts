import { mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises'
import { isAbsolute, join, relative, resolve, sep } from 'node:path'
import type { ViewKind } from '@sd/shared'

export class PathEscapeError extends Error {}

export type FileEntry = { path: string; size: number }

/**
 * Skipped when listing a view's files — build output and VCS metadata are not
 * source the client should see or edit. Deliberately separate from scan.ts's
 * identically-named set, which answers a different question (what counts
 * toward a project's newest-modified time). Do not merge them: a directory
 * one file wants ignored the other may still want to inspect.
 */
const IGNORED_DIRS = new Set(['.git', 'node_modules', 'out', 'build', 'target', 'bin', 'obj'])

/**
 * Resolves a client-supplied relative path inside a view directory, refusing
 * anything that escapes it. This is the only genuine trust boundary in M1:
 * `relPath` arrives over HTTP from the browser, so it must be treated as
 * hostile input. On a containment failure this throws rather than silently
 * stripping `..` segments and continuing — a sanitise-and-proceed strategy is
 * how these bugs come back later.
 *
 * The check is structural, not a list of known-bad substrings: after
 * resolving `relPath` against the view root, the result must land strictly
 * inside it, decided purely by comparing resolved absolute paths.
 *
 * One Windows-specific input needs a syntactic pre-check rather than relying
 * on that structural comparison alone: a drive-relative path such as `C:foo`
 * (a drive letter with no separator after the colon) is not absolute by
 * Node's own definition, and `path.resolve` does not always fold it back
 * against the supplied base. When the referenced drive differs from the
 * base's drive, Windows resolves it against that *other* drive's current
 * directory — a location this process does not control and that has nothing
 * to do with the view. Verified experimentally: resolving `C:foo` against a
 * view rooted on `D:` lands wherever this process's cwd on `C:` happens to
 * be, entirely outside any project. Rejecting anything with a leading drive
 * letter, absolute or not, closes that off before the structural check ever
 * runs.
 */
export function resolveInView(projectDir: string, view: ViewKind, relPath: string): string {
  if (!relPath || relPath.trim() === '') {
    throw new PathEscapeError('Empty path')
  }
  if (isAbsolute(relPath) || /^[a-zA-Z]:/.test(relPath)) {
    throw new PathEscapeError(`Path "${relPath}" is outside the view`)
  }

  const viewRoot = resolve(projectDir, view)
  const target = resolve(viewRoot, relPath)
  const rel = relative(viewRoot, target)

  // rel === '' means relPath normalised to the view root itself (e.g. '.' or
  // 'src/..') — a caller must always name a file, never the directory.
  if (rel === '' || rel.startsWith('..') || isAbsolute(rel)) {
    throw new PathEscapeError(`Path "${relPath}" is outside the view`)
  }
  return target
}

async function walk(root: string, current: string, out: FileEntry[]): Promise<void> {
  let entries
  try {
    entries = await readdir(current, { withFileTypes: true })
  } catch {
    return
  }

  for (const entry of entries) {
    const abs = join(current, entry.name)
    if (entry.isDirectory()) {
      if (IGNORED_DIRS.has(entry.name)) continue
      await walk(root, abs, out)
    } else if (entry.isFile()) {
      const info = await stat(abs)
      // Windows yields backslashes from path.relative; the same string must
      // round-trip back into readViewFile/writeViewFile unchanged from a
      // browser, so every platform emits forward slashes.
      out.push({ path: relative(root, abs).split(sep).join('/'), size: info.size })
    }
  }
}

/**
 * Lists every file under a view, recursively, skipping build output and VCS
 * directories. A view directory that does not exist yields an empty list
 * rather than an error — a project may legitimately have no `hld/` view yet.
 */
export async function listViewFiles(projectDir: string, view: ViewKind): Promise<FileEntry[]> {
  const root = resolve(projectDir, view)
  const out: FileEntry[] = []
  await walk(root, root, out)
  out.sort((a, b) => a.path.localeCompare(b.path))
  return out
}

export async function readViewFile(
  projectDir: string,
  view: ViewKind,
  relPath: string,
): Promise<string> {
  return readFile(resolveInView(projectDir, view, relPath), 'utf8')
}

/**
 * Writes a file inside a view, creating missing parent directories so a
 * client can create e.g. `src/model/Ticket.java` without a prior mkdir. The
 * directory is only created after `resolveInView` has validated the path —
 * never before, so a hostile path cannot cause directory creation outside
 * the view even as a side effect of a rejected write.
 */
export async function writeViewFile(
  projectDir: string,
  view: ViewKind,
  relPath: string,
  content: string,
): Promise<void> {
  const target = resolveInView(projectDir, view, relPath)
  await mkdir(resolve(target, '..'), { recursive: true })
  await writeFile(target, content, 'utf8')
}
