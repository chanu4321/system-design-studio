# System Design

A local-first platform for storing low-level-design (and, from M2, high-level-design)
projects as real folders of source files. The app is a viewer and editor over those
files — it never owns them. Each project lives under `projects/` as an ordinary
directory tree you can open in an IDE, diff, and commit like any other code.

## Status

This is **M1: storage and editing** — creating projects, browsing a view's files, and
reading/writing them through the web UI. The live relationship graph (parsing source
into an interactive HLD/LLD diagram) is **M2**, not yet built.

## Layout

- `apps/server` — Fastify API. Serves project metadata (backed by SQLite or Postgres)
  and file read/write endpoints scoped to a project's view directories.
- `apps/web` — Vite + React UI. Lists projects and provides a file tree and editor for
  a project's files, talking to the server through a same-origin `/api` proxy.
- `packages/shared` — Types and Zod schemas shared between server and web (project
  manifest, view kinds, API request/response shapes).
- `packages/store` — The metadata store abstraction, with SQLite and Postgres
  implementations validated against a shared contract test suite.

## Getting started

```
pnpm install
pnpm dev
```

This starts the web app on `http://localhost:5173` and the API server on
`http://localhost:5174`; Vite proxies `/api` requests from the former to the latter.

## Configuration

An `.env` file is optional and git-ignored — copy `.env.example` if you want one.

- `DATABASE_URL` — leave unset to use a local SQLite database (`data/lld.db`). Set it
  to a Postgres connection string to use Postgres instead.
- `TEST_DATABASE_URL` — only needed to run the Postgres contract test suite. It must
  point at a throwaway database: the suite truncates the `projects` table before every
  test, and refuses to run at all if it matches `DATABASE_URL`.

## Tests and typecheck

```
pnpm test       # runs every package's test suite
pnpm typecheck  # tsc --strict across all four packages
```

## Projects

`projects/` holds the actual project folders — real source files, not a database
export. Open them directly in VS Code, edit them outside the app, diff them, commit
them; the app is one more way of getting at the same files, not the source of truth
for their content.
