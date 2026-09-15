// entry point: parses the cli flags from docs/api.md, loads config, binds the
// board to 127.0.0.1 and opens it.
import { execFileSync, spawn } from 'node:child_process'
import { statSync } from 'node:fs'
import { createServer } from 'node:net'
import { basename, dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'
import { serve } from '@hono/node-server'
import { createApp, newToken } from './app'
import { BdError, BeadsClient } from './bd'
import { loadConfig, type ResolvedBoardConfig } from './config'

const DEFAULT_PORT = 1338
/** how many ports past the default to try when no --port is given */
const PORT_TRIES = 20

export interface Options {
  repo: string
  /** undefined means the first free port from 1338 up */
  port: number | undefined
  agentsview: string | null | undefined
  config?: string
  open: boolean
}

/** parses `bd-board [--repo <path>] [--port <n>] [--config <path>] [--agentsview <url>|--no-agentsview] [--no-open]` */
export function parseOptions(argv: string[]): Options {
  const { values } = parseArgs({
    args: argv,
    options: {
      repo: { type: 'string' },
      port: { type: 'string' },
      config: { type: 'string' },
      'agentsview': { type: 'string' },
      'no-agentsview': { type: 'boolean' },
      'no-open': { type: 'boolean' },
    },
    allowPositionals: false,
  })

  const port = values.port === undefined ? undefined : Number(values.port)
  if (port !== undefined && (!Number.isInteger(port) || port < 0 || port > 65535)) {
    throw new Error('--port must be between 0 and 65535')
  }

  let agentsview: string | null | undefined = undefined
  if (values['no-agentsview']) {
    agentsview = null
  } else if (values['agentsview']) {
    agentsview = values['agentsview']
  }

  return {
    repo: resolve(values.repo ?? process.cwd()),
    port,
    agentsview,
    config: values.config,
    open: !values['no-open'],
  }
}

/**
 * the bd issue prefix, taken off an exported id: `demo-9fz` and
 * `demo-zf8.4` both give `demo`.
 */
export function repoNameFromId(id: string): string | null {
  const withoutSuffix = id.replace(/\.\d+$/, '')
  const cut = withoutSuffix.lastIndexOf('-')
  return cut > 0 ? withoutSuffix.slice(0, cut) : null
}

/** resolves current user identity: $BEADS_ACTOR, git user.name, or $USER */
export function resolveActor(repoPath: string): string {
  const envActor = process.env['BEADS_ACTOR']?.trim()
  if (envActor) return envActor
  try {
    const gitUser = execFileSync('git', ['config', 'user.name'], {
      cwd: repoPath,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim()
    if (gitUser) return gitUser
  } catch {
    // git config not found or failed
  }
  const envUser = process.env['USER']?.trim()
  if (envUser) return envUser
  return 'unknown'
}

/** true when nothing is listening on 127.0.0.1:<port> */
export function portFree(port: number): Promise<boolean> {
  return new Promise((done) => {
    const probe = createServer()
    probe.once('error', () => done(false))
    probe.once('listening', () => probe.close(() => done(true)))
    probe.listen(port, '127.0.0.1')
  })
}

/** the first free port from `start` up, so a second board next to a running one just works */
export async function firstFreePort(start: number, tries: number): Promise<number | null> {
  for (let port = start; port < start + tries; port += 1) {
    if (await portFree(port)) return port
  }
  return null
}

/** opens the url in the platform's default browser */
export function openBrowser(url: string): void {
  let cmd: string
  let args: string[]
  if (process.platform === 'darwin') {
    cmd = 'open'
    args = [url]
  } else if (process.platform === 'win32') {
    cmd = 'cmd'
    args = ['/c', 'start', '', url]
  } else {
    cmd = 'xdg-open'
    args = [url]
  }
  const child = spawn(cmd, args, { stdio: 'ignore', detached: true })
  child.on('error', () => console.error(`bd-board: could not run ${cmd}; open the url yourself`))
  child.unref()
}

async function main(): Promise<void> {
  let options: Options
  try {
    options = parseOptions(process.argv.slice(2))
  } catch (error) {
    console.error(`bd-board: ${error instanceof Error ? error.message : String(error)}`)
    process.exit(2)
  }

  try {
    if (!statSync(options.repo).isDirectory()) throw new Error('not a directory')
  } catch {
    console.error(`bd-board: repo is not a directory: ${options.repo}`)
    process.exit(2)
  }

  let config: ResolvedBoardConfig
  try {
    config = loadConfig(options.repo, options.config)
  } catch (error) {
    console.error(`bd-board: ${error instanceof Error ? error.message : String(error)}`)
    process.exit(2)
  }

  const agentsview =
    options.agentsview !== undefined ? options.agentsview : config.agentsview
  const me = resolveActor(options.repo)

  const client = new BeadsClient(options.repo)
  let name = basename(options.repo)
  try {
    const issues = await client.issues()
    const derived = issues.length ? repoNameFromId(issues[0]!.id) : null
    if (derived) name = derived
  } catch (error) {
    const message = error instanceof BdError ? error.message : String(error)
    console.error(`bd-board: could not read the backlog (${message})`)
    process.exit(1)
  }

  const uiDist = resolve(dirname(fileURLToPath(import.meta.url)), '../ui/dist')
  const app = createApp({
    client,
    repo: { name, path: options.repo },
    agentsview,
    me,
    config,
    token: newToken(),
    uiDist,
  })

  const port = options.port ?? (await firstFreePort(DEFAULT_PORT, PORT_TRIES))
  if (port === null) {
    console.error(`bd-board: no free port between ${DEFAULT_PORT} and ${DEFAULT_PORT + PORT_TRIES - 1}; pass --port`)
    process.exit(1)
  }

  const server = serve({ fetch: app.fetch, hostname: '127.0.0.1', port }, (info) => {
    const url = `http://127.0.0.1:${info.port}/`
    console.log(`bd-board: ${name} (${options.repo})`)
    console.log(`open: ${url}`)
    if (agentsview) console.log(`agentsview: ${agentsview}`)
    console.log('press Ctrl-C to stop')
    if (options.open) {
      openBrowser(url)
    }
  })

  const stop = () => {
    server.close(() => process.exit(0))
  }
  process.on('SIGINT', stop)
  process.on('SIGTERM', stop)
}

// only run when executed, so tests can import the helpers
if (
  process.argv[1] &&
  import.meta.url.startsWith('file:') &&
  fileURLToPath(import.meta.url) === resolve(process.argv[1])
) {
  void main()
}
