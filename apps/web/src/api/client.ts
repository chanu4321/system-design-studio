import type {
  CreateProjectBody,
  FileContentResponse,
  FileListResponse,
  ProjectListResponse,
  ProjectSummaryDto,
} from '@sd/shared'

type ViewKind = 'lld' | 'hld'

async function json<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const body = (await res.json().catch(() => ({ error: res.statusText }))) as { error?: string }
    throw new Error(body.error ?? `Request failed with ${res.status}`)
  }
  return res.json() as Promise<T>
}

export class ApiClient {
  constructor(private readonly base = '') {}

  listProjects(): Promise<ProjectListResponse> {
    return fetch(`${this.base}/api/projects`).then(json<ProjectListResponse>)
  }

  createProject(body: CreateProjectBody): Promise<ProjectSummaryDto> {
    return fetch(`${this.base}/api/projects`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }).then(json<ProjectSummaryDto>)
  }

  listFiles(id: string, view: ViewKind): Promise<FileListResponse> {
    return fetch(`${this.base}/api/projects/${id}/views/${view}/files`).then(json<FileListResponse>)
  }

  readFile(id: string, view: ViewKind, path: string): Promise<FileContentResponse> {
    const q = encodeURIComponent(path)
    return fetch(`${this.base}/api/projects/${id}/views/${view}/file?path=${q}`).then(
      json<FileContentResponse>,
    )
  }

  async writeFile(id: string, view: ViewKind, path: string, content: string): Promise<void> {
    const res = await fetch(`${this.base}/api/projects/${id}/views/${view}/file`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ path, content }),
    })
    if (!res.ok) throw new Error(`Save failed with ${res.status}`)
  }
}
