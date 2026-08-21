import { mkdir, writeFile } from 'node:fs/promises'
import { basename, isAbsolute, join, relative, sep } from 'node:path'

const PACKAGE = /^\s*package\s+([\w.]+)\s*;/m

/**
 * Strips `/* ... *\/` block comments and `// ...` line comments from Java
 * source text before it is handed to `PACKAGE`, so a commented-out
 * `package` line (a leftover from an ordinary refactor, not an adversarial
 * input) is never mistaken for the real declaration.
 *
 * Non-nesting block-comment matching (`[\s\S]*?` up to the *first* `*\/`) is
 * not an approximation here — Java block comments do not nest, so stopping
 * at the first closer is exactly correct per the language grammar, not a
 * shortcut.
 *
 * What *is* deliberately approximate: this does not track string or char
 * literals, so a `//` or `/*` occurring inside one would be misread as a
 * comment start. That is safe for what this function is used for — locating
 * the leading package declaration — because in valid Java nothing but
 * whitespace and comments may precede the package declaration, so there is
 * no string literal to trip over in the region that matters. A literal
 * later in the file (inside a method body, say) could have text after it
 * mangled by this stripper, but that is always past the point where the
 * leading package declaration has already been found (or definitively
 * absent), so it cannot change this function's result. Text blocks
 * (`"""..."""`) and Unicode escapes that spell out comment delimiters are
 * not handled either. This is not a Java parser and is not trying to be
 * one — it only needs to be right about the handful of ordinary shapes a
 * refactor leaves behind (license headers, commented-out old package
 * lines, Javadoc).
 */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, ' ')
}

/**
 * Writes editor buffers into a temp tree shaped the way `javac` demands:
 * a file declaring `package com.example` must live at `com/example/*.java`,
 * regardless of where the view keeps it (`lld/src/...` or anything else).
 *
 * The package is read from each file's own text rather than taken as a
 * parameter — the runner receives plain buffers, not model nodes, and
 * re-deriving the package here keeps the temp layout and the source text it
 * was derived from in step with each other. It matters that this agrees
 * with the model's tree-sitter-derived package: Task 15 builds the entry
 * point's fully-qualified name from the model, and if this regex-based
 * derivation disagreed (e.g. by picking up a commented-out package line),
 * the class would compile into one directory while `java` is asked for a
 * name in another, surfacing as a `ClassNotFoundException` that reads like
 * a bug in the user's code rather than ours. `stripComments` above exists
 * to keep the two derivations aligned on ordinary refactor leftovers.
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
    const pkg = PACKAGE.exec(stripComments(file.content))?.[1]
    const dir = pkg ? join(root, ...pkg.split('.')) : root

    // `basename('.')` and `basename('')` both come back as themselves
    // (`.` and `''`), and joining either onto `dir` yields `dir` itself —
    // not a file. Reject before we ever build a target that names a
    // directory, so the error names the real problem instead of surfacing
    // later as a raw EISDIR from `writeFile`.
    const base = basename(file.path)
    if (base === '' || base === '.') {
      throw new Error(`Refusing to write '${file.path}': it does not name a file`)
    }
    const target = join(dir, base)

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
    //
    // The comparison is against the `..` *segment*, not a string prefix:
    // `rel.startsWith('..')` would also reject a file honestly named
    // `..hidden.java` or `....java`, whose `relative()` text happens to
    // start with two dots while staying safely inside `root`. Checking for
    // an exact `'..'` or a `'..' + sep` prefix only matches when `..` is
    // actually a path segment.
    const rel = relative(root, target)
    if (rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)) {
      throw new Error(`Refusing to write outside the run directory: ${file.path}`)
    }

    await mkdir(dir, { recursive: true })
    await writeFile(target, file.content, 'utf8')
    written.push(target)
  }
  return written
}
