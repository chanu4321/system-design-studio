import type {
  CreateProjectBody,
  FileContentResponse,
  FileListResponse,
  ProjectListResponse,
  ProjectSummaryDto,
  ViewContentsResponse,
  ViewKind,
} from '@sd/shared'

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

  readViewContents(id: string, view: ViewKind): Promise<ViewContentsResponse> {
    return fetch(`${this.base}/api/projects/${id}/views/${view}/contents`).then(
      json<ViewContentsResponse>,
    )
  }

  async writeFile(
    id: string,
    view: ViewKind,
    path: string,
    content: string,
    expectedMtimeMs?: number,
  ): Promise<void> {
    const res = await fetch(`${this.base}/api/projects/${id}/views/${view}/file`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ path, content, expectedMtimeMs }),
    })
    if (!res.ok) {
      // The status carries meaning the message cannot: 409 is a conflict the
      // user resolves, everything else is a failure they can only report.
      const body = (await res.json().catch(() => ({ error: res.statusText }))) as { error?: string }
      throw Object.assign(new Error(body.error || `Save failed with ${res.status}`), {
        status: res.status,
      })
    }
  }
}
