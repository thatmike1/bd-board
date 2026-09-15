# bd-board API contract

The server is the only thing that runs `bd`. The UI talks to it over HTTP on the same origin (in dev, Vite proxies `/api` to the server port). This file is the contract both sides build against.

## Conventions

- JSON everywhere. Errors: status 4xx or 5xx with body `{ "error": "<message>" }`.
- Every POST and DELETE needs the header `x-bd-token: <token>` where the token comes from `GET /api/session`. The server binds to `127.0.0.1` only.
- Issue ids are full ids (`demo-9fz`). The UI shortens for display.
- Timestamps are ISO strings as `bd` emits them.

## Types

```ts
type Status = 'open' | 'in_progress' | 'blocked' | 'deferred' | 'closed'

interface Issue {            // one record of `bd export` (JSONL, `_type === 'issue'`), `_type` dropped
  id: string
  title: string
  description: string
  status: Status
  priority: 0 | 1 | 2 | 3 | 4  // 0 highest
  issue_type: string           // task | epic | bug | feature | chore | decision
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

interface Comment { id: string; issue_id: string; author: string; text: string; created_at: string }

interface SessionHit {       // from AgentsView /api/v1/search?q=<id>&limit=<n>
  session_id: string
  title: string              // T3 thread title when matched, otherwise session name (first prompt)
  prompt?: string            // first prompt when title was replaced by T3 thread title
  day: string                // YYYY-MM-DD
  modified: string
  agent: string              // claude, codex, etc.
  url: string                // per-session deep link: {base}/sessions/{id}?msg={ordinal}
}

interface NoteHit { file: string; line: number; excerpt: string }   // recursive scan of <notesDir>/*.md for the id

interface IssueDetail {
  issue: Issue               // from `bd show <id> --json`; includes `notes` when present
  comments: Comment[]        // `bd comments <id> --json`
  sessions: SessionHit[] | null   // null when AgentsView is off or not reachable
  notes: NoteHit[]
}

interface LaneConfig { label: string; note: string | null; glyph: string; color: string }
interface UnlanedConfig { title: string; note: string | null }
interface WaitingConfig { labels: string[]; title: string; note: string | null }
interface NoteConfig { addLabel: string | null; offerToClear: string[] }
interface ThoughtsConfig { label: string; title: string; note: string | null }
interface CaptureConfig { labels: string[] }
interface DerivedConfig { allFlags: string[]; hotChips: string[] }

interface BoardConfig {
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

interface SessionInfo {
  token: string
  repo: { name: string; path: string }
  agentsview: string | null
  me: string
  config: BoardConfig
}
```

## Endpoints

| method | path | body | returns |
|---|---|---|---|
| GET | `/api/session` | | `SessionInfo` |
| GET | `/api/issues` | | `{ issues: Issue[], fetchedAt: string }` all statuses, the UI filters |
| GET | `/api/issue-ids` | | `{ ids: string[] }` all statuses; readable cross-origin from the T3 Code renderer and loopback pages, which link short ids in chat |
| GET | `/api/issues/:id` | | `IssueDetail` |
| POST | `/api/issues/:id/comment` | `{ text: string, clear?: boolean }` | `IssueDetail` |
| POST | `/api/issues/:id/status` | `{ status: Status, reason?: string, until?: string }` | `{ issue }` |
| POST | `/api/issues/:id/priority` | `{ priority: number }` | `{ issue }` |
| POST | `/api/issues/:id/labels` | `{ add?: string[], remove?: string[] }` | `{ issue }` |
| POST | `/api/issues` | `{ title: string, labels?: string[] }` | `{ issue }` quick capture via `bd q` |
| DELETE | `/api/issues/:id` | | `{ deleted }`; only ids this server process created, otherwise 403. Undo for quick capture |

## Server behaviour per write

- comment: `bd comment <id> <text>`; if `config.note.addLabel` is configured, runs `bd label add <id> <addLabel>`; if `clear` is true, removes any `config.note.offerToClear` labels the issue carries.
- status: `closed` runs `bd close <id> --reason <reason|"closed from bd-board">`; `deferred` runs `bd defer <id> [--until <until>]`; `open` from `closed` runs `bd reopen <id>`; `open` from `deferred` runs `bd undefer <id>`; anything else runs `bd update <id> --status <status>`.
- priority: `bd update <id> --priority <n>`.
- labels: one `bd update <id> --add-label a --remove-label b` call. Labels: 1 to 128 chars, no whitespace.
- create: `bd q <title> -l <label>...`; defaults to `config.capture.labels` when none given.

The server never accepts a raw argument list from the client. Every route maps to a fixed argument shape; ids are validated against `^[A-Za-z0-9_-]+(\.[0-9]+)?$` before use. Every `bd` call runs with `cwd` set to the repo path and `--no-color` where supported; output is parsed, never echoed to the client on success.

## Config and launch

`bd-board [--repo <path>] [--port <n>] [--config <path>] [--agentsview <url>|--no-agentsview] [--no-open]`

Defaults: repo = cwd, port = the first free port from 1338 up (an explicit `--port` fails if taken), agentsview = from config or off (`null`), opens the browser. Repo name = the `bd` issue prefix (derived from the first exported id, or the folder name when the export is empty).
