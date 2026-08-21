import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, it } from 'vitest'

// Not `new URL('./styles.css', import.meta.url)`: Vite statically rewrites that
// exact pattern into an asset URL (resolved against the dev server origin), so
// under vitest it produces `http://localhost:3000/...` instead of a file: URL
// and readFile rejects it. Building the path with node:path/node:url sidesteps
// Vite's asset-URL transform entirely.
const cssPath = join(dirname(fileURLToPath(import.meta.url)), 'styles.css')

it('defines every colour, radius and spacing value as a custom property', async () => {
  const css = await readFile(cssPath, 'utf8')
  const body = css.slice(css.indexOf('}') + 1) // skip the :root block itself

  // No raw hex, rgb() or px radius outside :root. currentColor and named
  // keywords stay — they are inherited-by-design, not undeclared values.
  expect(body).not.toMatch(/#[0-9a-f]{3,8}\b/i)
  expect(body).not.toMatch(/\brgba?\(/)
  expect(body).not.toMatch(/border-radius:\s*[\d.]/)
})

it('declares the token block on :root', async () => {
  const css = await readFile(cssPath, 'utf8')
  for (const token of ['--radius-node', '--radius-card', '--space-1', '--font-size-node']) {
    expect(css).toContain(token)
  }
})
