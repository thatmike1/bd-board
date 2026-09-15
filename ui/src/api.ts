// typed fetch helpers for every endpoint in docs/api.md

export type Status = 'open' | 'in_progress' | 'blocked' | 'deferred' | 'closed'

export interface Issue {
  id: string
  title: string
  description: string
  status: Status
  priority: 0 | 1 | 2 | 3 | 4
  issue_type: string
  labels: string[]
  owner?: string
  created_by?: string
  created_at: string
  updated_at: string
  closed_at?: string | null
  close_reason?: string
  notes?: string
  comment_count: number
  dependency_count: number
  dependent_count: number
}

export interface Comment {
  id: string
  issue_id: string
  author: string
  text: string
  created_at: string
}

export interface SessionHit {
  session_id: string
  title: string
  prompt?: string
  day: string
  modified: string
  agent: string
  url: string
}

export interface NoteHit {
  file: string
  line: number
  excerpt: string
}

export interface IssueDetail {
  issue: Issue
  comments: Comment[]
  sessions: SessionHit[] | null
  notes: NoteHit[]
}

export interface LaneConfig {
  label: string
  note: string | null
  glyph: string
  color: string
}

export interface UnlanedConfig {
  title: string
  note: string | null
}

export interface WaitingConfig {
  labels: string[]
  title: string
  note: string | null
}

export interface NoteConfig {
  addLabel: string | null
  offerToClear: string[]
}

export interface ThoughtsConfig {
  label: string
  title: string
  note: string | null
}

export interface CaptureConfig {
  labels: string[]
}

export interface DerivedConfig {
  allFlags: string[]
  hotChips: string[]
}

export interface BoardConfig {
  agentsview: string | null
  notesDir: string | null
  lanes: LaneConfig[]
  unlaned: UnlanedConfig
  subLabels: string[]
  waiting: WaitingConfig
  note: NoteConfig
  thoughts: ThoughtsConfig | null
  flags: string[]
  capture: CaptureConfig
  derived: DerivedConfig
}

export interface SessionInfo {
  token: string
  repo: { name: string; path: string }
  agentsview: string | null
  me: string
  config: BoardConfig
}

export interface IssueList {
  issues: Issue[]
  fetchedAt: string
}

let token: string | null = null

/** raw json fetch that turns `{ error }` bodies into thrown errors */
async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, init)
  const text = await res.text()
  let body: unknown = null
  if (text) {
    try {
      body = JSON.parse(text)
    } catch {
      throw new Error(`${path}: response was not json`)
    }
  }
  if (!res.ok) {
    const message =
      body && typeof body === 'object' && 'error' in body
        ? String((body as { error: unknown }).error)
        : `${res.status} ${res.statusText}`
    throw new Error(message)
  }
  return body as T
}

/** session config: write token, repo identity, agentsview url, me, and resolved board config */
export async function getSession(): Promise<SessionInfo> {
  const info = await call<SessionInfo>('/api/session')
  token = info.token
  return info
}

/** the write token, fetching the session first when the ui has not loaded it yet */
async function ensureToken(): Promise<string> {
  if (token) return token
  const info = await getSession()
  return info.token
}

/** DELETE with the write token; the server only allows beads the board itself filed */
async function del<T>(path: string): Promise<T> {
  const t = await ensureToken()
  return call<T>(path, { method: 'DELETE', headers: { 'x-bd-token': t } })
}

async function post<T>(path: string, body: unknown): Promise<T> {
  const t = await ensureToken()
  return call<T>(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-bd-token': t },
    body: JSON.stringify(body),
  })
}

/** every issue in the repo, all statuses; the ui filters */
export function getIssues(): Promise<IssueList> {
  return call<IssueList>('/api/issues')
}

/** one issue with its comments, the sessions that mention it and matching notes lines */
export function getIssue(id: string): Promise<IssueDetail> {
  return call<IssueDetail>(`/api/issues/${encodeURIComponent(id)}`)
}

/** runs `bd comment` and updates labels via the server's note config */
export function postComment(
  id: string,
  text: string,
  clear?: boolean,
): Promise<IssueDetail> {
  const body: { text: string; clear?: boolean } =
    clear === undefined ? { text } : { text, clear }
  return post<IssueDetail>(`/api/issues/${encodeURIComponent(id)}/comment`, body)
}

/** close, defer, reopen or plain status change */
export function setStatus(
  id: string,
  status: Status,
  extra?: { reason?: string; until?: string },
): Promise<{ issue: Issue }> {
  return post<{ issue: Issue }>(`/api/issues/${encodeURIComponent(id)}/status`, {
    status,
    ...extra,
  })
}

/** 0 is highest */
export function setPriority(id: string, priority: number): Promise<{ issue: Issue }> {
  return post<{ issue: Issue }>(`/api/issues/${encodeURIComponent(id)}/priority`, { priority })
}

/** one call adds and removes labels together */
export function editLabels(
  id: string,
  change: { add?: string[]; remove?: string[] },
): Promise<{ issue: Issue }> {
  return post<{ issue: Issue }>(`/api/issues/${encodeURIComponent(id)}/labels`, change)
}

/** quick capture; labels default to server capture config when omitted */
export function createIssue(title: string, labels?: string[]): Promise<{ issue: Issue }> {
  const body: { title: string; labels?: string[] } =
    labels && labels.length ? { title, labels } : { title }
  return post<{ issue: Issue }>('/api/issues', body)
}

/** removes a bead the board just filed; the server refuses any other id */
export function deleteIssue(id: string): Promise<{ deleted: string }> {
  return del<{ deleted: string }>(`/api/issues/${encodeURIComponent(id)}`)
}
