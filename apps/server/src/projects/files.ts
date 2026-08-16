import { mkdir, readFile, readdir, realpath, stat, writeFile } from 'node:fs/promises'
import { isAbsolute, join, relative, resolve, sep } from 'node:path'
import type { FileEntry, ViewKind } from '@sd/shared'

export class PathEscapeError extends Error {}

export type { FileEntry }

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
 * The core check is structural, not a list of known-bad substrings: after
 * resolving `relPath` against the view root, the result must land strictly
 * inside it, decided purely by comparing resolved absolute paths. A few
 * syntactic pre-checks run first; see the comment at each for exactly what it
 * adds beyond that structural check, since more than one of them turned out
 * to guard something narrower than "prevents escape."
 *
 * This function is lexical only — it says nothing about a reparse point
 * (junction/symlink) already sitting inside the view and pointing elsewhere
 * on disk. `readViewFile`/`writeViewFile` layer a real-path check on top of
 * this one for that reason; see `assertRealPathInView`.
 */
export function resolveInView(projectDir: string, view: ViewKind, relPath: string): string {
  // Typed as string, but this value arrives from an HTTP body. A non-string must
  // fail as a PathEscapeError so the route answers 400, not 500 on a TypeError.
  if (typeof relPath !== 'string' || relPath.trim() === '') {
    throw new PathEscapeError('Path must be a non-empty string')
  }
  // A drive-qualified path must never be silently reinterpreted as view-relative.
  // Note what this guard does and does not do: `resolve(viewRoot, 'C:foo')` folds
  // to `<viewRoot>/foo` when the view is on drive C, so without it the caller's
  // `C:foo` would quietly come to mean `foo`. The *cross-drive* case needs no help
  // from here — `relative()` cannot express a cross-device relation, so it returns
  // an absolute path that the structural check below rejects. This guard prevents
  // a semantic misreading; the structural check is what prevents escape.
  if (isAbsolute(relPath) || /^[a-zA-Z]:/.test(relPath)) {
    throw new PathEscapeError(`Path "${relPath}" is outside the view`)
  }
  // ':' cannot occur in a Windows filename. Allowing it lets a caller write an
  // NTFS alternate data stream attached to an in-view file — contained, but
  // invisible to listViewFiles and unreachable by any other call.
  if (relPath.includes(':')) {
    throw new PathEscapeError(`Path "${relPath}" is outside the view`)
  }

  const viewRoot = resolve(projectDir, view)
  const target = resolve(viewRoot, relPath)
  const rel = relative(viewRoot, target)

  // Compare against a '..' segment, not a '..' prefix: a bare startsWith('..')
  // also rejects legitimate filenames such as '..hidden.java'. rel === '' means
  // relPath normalised to the view root itself (e.g. '.' or 'src/..'), which is
  // refused — but that is the only directory this function refuses. A relPath
  // naming an ordinary subdirectory (e.g. 'src', or 'src/.') resolves
  // successfully here; this function does not otherwise distinguish a file
  // target from a directory target, and readFile/writeFile fail on their own
  // if the resolved target turns out to be a directory.
  if (rel === '' || rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)) {
    throw new PathEscapeError(`Path "${relPath}" is outside the view`)
  }
  return target
}

/** Deepest ancestor of `path` that exists, fully resolved through any links. */
async function nearestRealPath(path: string): Promise<string> {
  let probe = path
  for (;;) {
    try {
      return await realpath(probe)
    } catch {
      const parent = resolve(probe, '..')
      if (parent === probe) return probe
      probe = parent
    }
  }
}

/**
 * Lexical containment alone is not enough. A reparse point already inside the
 * view — a junction or symlink, creatable by any unelevated local user — is an
 * ordinary-looking relative path with no `..` and no drive letter that resolves,
 * at the filesystem level, somewhere else entirely. A caller cannot create one
 * through this API, but it can traverse one that exists.
 *
 * The target may not exist yet, so resolve its deepest existing ancestor.
 */
async function assertRealPathInView(viewRoot: string, target: string): Promise<void> {
  const realRoot = await nearestRealPath(viewRoot)
  const realTarget = await nearestRealPath(target)
  const rel = relative(realRoot, realTarget)

  if (rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)) {
    throw new PathEscapeError('Path resolves outside the view')
  }
}

async function walk(root: string, current: string, out: FileEntry[]): Promise<void> {
  let entries
  try {
    entries = await readdir(current, { withFileTypes: true })
  } catch (err) {
    // A missing directory is an empty listing. Anything else — EACCES, EMFILE —
    // would otherwise be presented to the user as a complete listing that is
    // silently short.
    const code = (err as NodeJS.ErrnoException).code
    if (code === 'ENOENT' || code === 'ENOTDIR') return
    throw err
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
  // Plain codepoint order, not localeCompare: collation is locale-aware and
  // varies with the ICU build, so it is not a deterministic sort across machines.
  out.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))
  return out
}

export async function readViewFile(
  projectDir: string,
  view: ViewKind,
  relPath: string,
): Promise<string> {
  const viewRoot = resolve(projectDir, view)
  const target = resolveInView(projectDir, view, relPath)
  await assertRealPathInView(viewRoot, target)
  return readFile(target, 'utf8')
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
  const viewRoot = resolve(projectDir, view)
  const target = resolveInView(projectDir, view, relPath)
  // Checked before anything touches the filesystem — never mkdir first.
  await assertRealPathInView(viewRoot, target)
  await mkdir(resolve(target, '..'), { recursive: true })
  await writeFile(target, content, 'utf8')
}
