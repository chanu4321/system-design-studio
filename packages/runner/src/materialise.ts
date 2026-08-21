import { mkdir, writeFile } from 'node:fs/promises'
import { basename, isAbsolute, join, relative } from 'node:path'

const PACKAGE = /^\s*package\s+([\w.]+)\s*;/m

/**
 * Writes editor buffers into a temp tree shaped the way `javac` demands:
 * a file declaring `package com.example` must live at `com/example/*.java`,
 * regardless of where the view keeps it (`lld/src/...` or anything else).
 *
 * The package is read from each file's own text rather than taken as a
 * parameter — the runner receives plain buffers, not model nodes, and
 * re-deriving the package here keeps the temp layout and the source text it
 * was derived from in step with each other.
 *
 * Returns the written absolute paths in the same order as `files`, one per
 * input element (this function never merges or drops entries — the `for`
 * loop below pushes exactly one path per iteration). Task 9 zips this
 * against `req.files` by index to map compiler diagnostics back to
 * view-relative paths, so callers may rely on `written[i]` corresponding to
 * `files[i]`.
 */
export async function materialise(
  files: { path: string; content: string }[],
  root: string,
): Promise<string[]> {
  const written: string[] = []
  for (const file of files) {
    const pkg = PACKAGE.exec(file.content)?.[1]
    const dir = pkg ? join(root, ...pkg.split('.')) : root
    const target = join(dir, basename(file.path))

    // The temp root is ours; a crafted path must never write outside it.
    //
    // This branch is nearly unreachable, and for the reason a first glance
    // suggests: `target` is built from `basename(file.path)`, which strips
    // every directory *separator* before the path is joined onto `dir`, so
    // an ordinary traversal like `'../evil.java'` is flattened to
    // `'evil.java'` and lands harmlessly inside `root`.
    //
    // But `basename()` strips separators, not `..` segments themselves — a
    // path whose *last* segment already has no separator in front of it,
    // e.g. `'..'` or `'foo/..'`, comes back from `basename()` unchanged as
    // `'..'`, and `join(dir, '..')` really does walk back out of `dir`. That
    // is the one input shape that still reaches this throw today (see
    // materialise.test.ts's "bare traversal segment" case). It stays anyway
    // as defence in depth: cheap, and it becomes reachable for far more
    // inputs the moment a future change preserves source directory structure
    // (e.g. to avoid same-basename collisions) instead of flattening every
    // file to its basename.
    const rel = relative(root, target)
    if (rel.startsWith('..') || isAbsolute(rel)) {
      throw new Error(`Refusing to write outside the run directory: ${file.path}`)
    }

    await mkdir(dir, { recursive: true })
    await writeFile(target, file.content, 'utf8')
    written.push(target)
  }
  return written
}
