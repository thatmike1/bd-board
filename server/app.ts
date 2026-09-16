// the http surface described in docs/api.md. every route maps to one fixed bd
// argument shape; the client never gets to name a command or a flag.
import { randomBytes, timingSafeEqual } from 'node:crypto'
import { existsSync } from 'node:fs'
import { serveStatic } from '@hono/node-server/serve-static'
import { Hono } from 'hono'
import type { Context } from 'hono'
import type { ContentfulStatusCode } from 'hono/utils/http-status'
import { classifyAuthor, defaultHuman, type HumanIdentity } from './authors'
import { BdError, type BeadsClient, type Issue, type IssueWithComments, type Status } from './bd'
import { resolveConfig, type ResolvedBoardConfig } from './config'
import { notesFor, sessionsFor } from './joins'
import { DEFAULT_LIMIT, SCOPES, searchIssues, type SearchScope } from './search'

export interface AppConfig {
  client: BeadsClient
  repo: { name: string; path: string }
  agentsview: string | null
  /** who the board writes comments as; defaults to `human:$USER` */
  human?: HumanIdentity
  /** per-launch token; generated when omitted */
  token?: string
  config?: ResolvedBoardConfig
  /** absolute path to the built ui, served at / when it exists */
  uiDist?: string | null
}

/** a fresh per-launch token for the x-bd-token header */
export function newToken(): string {
  return randomBytes(24).toString('hex')
}

/**
 * origins allowed to read `/api/issue-ids` cross-origin: the T3 Code desktop
 * renderer, and loopback pages, which are local processes that could run `bd`
 * themselves. anything else still gets a response, just not a readable one.
 */
export function idsOriginAllowed(origin: string): boolean {
  if (origin === 't3code://app' || origin === 't3code-dev://app') return true
  try {
    const url = new URL(origin)
    return url.protocol === 'http:' && (url.hostname === '127.0.0.1' || url.hostname === 'localhost')
  } catch {
    return false
  }
}

function tokenMatches(given: string, expected: string): boolean {
  const a = Buffer.from(given)
  const b = Buffer.from(expected)
  return a.length === b.length && timingSafeEqual(a, b)
}

/** reads a JSON object body, rejecting anything else */
async function readBody(c: Context): Promise<Record<string, unknown>> {
  let payload: unknown
  try {
    payload = await c.req.json()
  } catch {
    throw new BdError('request body must be valid JSON')
  }
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new BdError('request body must be a JSON object')
  }
  return payload as Record<string, unknown>
}

function stringArray(value: unknown, what: string): string[] {
  if (value === undefined || value === null) return []
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) {
    throw new BdError(`${what} must be an array of strings`)
  }
  return value as string[]
}

/** how long a search may reuse the last `bd export` before reading the ledger again */
const CORPUS_MAX_AGE_MS = 5_000
const MAX_SEARCH_LIMIT = 500

/** builds the Hono app; `serve` in main.ts binds it to 127.0.0.1 */
export function createApp(config: AppConfig) {
  const { client, repo, agentsview } = config
  const token = config.token ?? newToken()
  const boardConfig = config.config ?? resolveConfig({})
  const human = config.human ?? defaultHuman(process.env['USER'] ?? 'unknown')
  const uiDist = config.uiDist ?? null

  // one export serves the list and search; any write from this board drops it
  let corpusCache: { at: number; corpus: IssueWithComments[] } | null = null
  const loadCorpus = async (maxAgeMs: number): Promise<IssueWithComments[]> => {
    if (corpusCache && Date.now() - corpusCache.at <= maxAgeMs) return corpusCache.corpus
    const corpus = await client.corpus()
    corpusCache = { at: Date.now(), corpus }
    return corpus
  }

  // bd writes go through one dolt working set; keep them one at a time
  let writeChain: Promise<unknown> = Promise.resolve()
  const serialise = <T>(work: () => Promise<T>): Promise<T> => {
    corpusCache = null
    const next = writeChain.then(work, work).finally(() => {
      corpusCache = null
    })
    writeChain = next.catch(() => undefined)
    return next
  }

  const app = new Hono()
  const createdHere = new Set<string>()

  app.onError((error, c) => {
    if (error instanceof BdError) return c.json({ error: error.message }, error.status as ContentfulStatusCode)
    const message = error instanceof Error ? error.message : 'server error'
    return c.json({ error: message }, 500)
  })

  // every write needs the per-launch token
  app.use('/api/*', async (c, next) => {
    if (c.req.method !== 'POST' && c.req.method !== 'DELETE') return next()
    if (!tokenMatches(c.req.header('x-bd-token') ?? '', token)) {
      return c.json({ error: 'invalid or missing x-bd-token' }, 403)
    }
    return next()
  })

  app.get('/api/session', (c) =>
    // config.human is filled with the identity in use, so the ui never has to guess the default
    c.json({ token, repo, agentsview, me: human.id, human, config: { ...boardConfig, human } }),
  )

  app.get('/api/issues', async (c) => {
    const issues = (await loadCorpus(0)).map((entry) => entry.issue)
    return c.json({ issues, fetchedAt: new Date().toISOString() })
  })

  // same ranking as `bd-board search`; reads comments from the export, not per issue
  app.get('/api/search', async (c) => {
    const query = c.req.query('q') ?? ''
    const scope = (c.req.query('scope') ?? 'all') as SearchScope
    if (!SCOPES.includes(scope)) throw new BdError('scope must be all, open or closed')
    const rawLimit = c.req.query('limit')
    const limit = rawLimit === undefined ? DEFAULT_LIMIT : Number(rawLimit)
    if (!Number.isInteger(limit) || limit < 1 || limit > MAX_SEARCH_LIMIT) {
      throw new BdError(`limit must be an integer between 1 and ${MAX_SEARCH_LIMIT}`)
    }
    if (!query.trim()) return c.json(searchIssues([], query, { scope, limit, human }))
    const corpus = await loadCorpus(CORPUS_MAX_AGE_MS)
    return c.json(searchIssues(corpus, query, { scope, limit, human }))
  })

  // ids only, so a page that is allowed to read it cross-origin learns nothing else
  app.get('/api/issue-ids', async (c) => {
    const origin = c.req.header('origin')
    if (origin && idsOriginAllowed(origin)) {
      c.header('Access-Control-Allow-Origin', origin)
      c.header('Vary', 'Origin')
    }
    const issues = await client.issues()
    return c.json({ ids: issues.map((issue) => issue.id) })
  })

  app.get('/api/issues/:id', async (c) => c.json(await detail(c.req.param('id'))))

  app.post('/api/issues', async (c) => {
    const body = await readBody(c)
    const title = body['title']
    if (typeof title !== 'string') throw new BdError('title must be a string')
    const hasLabels = body['labels'] !== undefined && body['labels'] !== null
    const wanted = hasLabels ? stringArray(body['labels'], 'labels') : boardConfig.capture.labels
    const issue = await serialise(() => client.create(title, wanted))
    createdHere.add(issue.id)
    return c.json({ issue })
  })

  // undo for quick capture: only beads this process filed can be removed
  app.delete('/api/issues/:id', async (c) => {
    const id = c.req.param('id')
    if (!createdHere.has(id)) throw new BdError('only beads created from this board session can be deleted', 403)
    await serialise(() => client.remove(id))
    createdHere.delete(id)
    return c.json({ deleted: id })
  })

  app.post('/api/issues/:id/comment', async (c) => {
    const id = c.req.param('id')
    const body = await readBody(c)
    const text = body['text']
    if (typeof text !== 'string') throw new BdError('text must be a string')
    const clear = body['clear']
    if (clear !== undefined && typeof clear !== 'boolean') throw new BdError('clear must be a boolean')
    const clearLabels = clear === true ? boardConfig.note.offerToClear : []
    await serialise(() => client.comment(id, text, { addLabel: boardConfig.note.addLabel, clearLabels }))
    return c.json(await detail(id))
  })

  app.post('/api/issues/:id/status', async (c) => {
    const id = c.req.param('id')
    const body = await readBody(c)
    const status = body['status']
    if (typeof status !== 'string') throw new BdError('status must be a string')
    const reason = body['reason']
    const until = body['until']
    if (reason !== undefined && typeof reason !== 'string') throw new BdError('reason must be a string')
    if (until !== undefined && typeof until !== 'string') throw new BdError('until must be a string')
    const issue = await serialise(() => client.setStatus(id, status as Status, reason, until))
    return c.json({ issue })
  })

  app.post('/api/issues/:id/priority', async (c) => {
    const id = c.req.param('id')
    const body = await readBody(c)
    const priority = body['priority']
    if (typeof priority !== 'number') throw new BdError('priority must be a number')
    const issue = await serialise(() => client.setPriority(id, priority))
    return c.json({ issue })
  })

  app.post('/api/issues/:id/labels', async (c) => {
    const id = c.req.param('id')
    const body = await readBody(c)
    const add = stringArray(body['add'], 'add')
    const remove = stringArray(body['remove'], 'remove')
    const issue = await serialise(() => client.setLabels(id, add, remove))
    return c.json({ issue })
  })

  app.all('/api/*', (c) => c.json({ error: 'not found' }, 404))

  if (uiDist && existsSync(uiDist)) {
    app.use('/*', serveStatic({ root: uiDist }))
    // client-side routes fall back to the spa shell
    app.get('/*', serveStatic({ path: `${uiDist}/index.html` }))
  }

  /** issue plus its comments and the two joins */
  async function detail(id: string) {
    const issue: Issue = await client.issue(id)
    const [comments, sessions, notes] = await Promise.all([
      client.comments(id),
      sessionsFor(id, agentsview),
      notesFor(id, repo.path, boardConfig.notesDir),
    ])
    return {
      issue,
      comments: comments.map((comment) => ({ ...comment, by: classifyAuthor(comment.author, human) })),
      sessions,
      notes,
    }
  }

  return app
}
