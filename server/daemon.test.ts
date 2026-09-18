import { mkdtempSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { clearState, readState, stateDir, stateStem, writeState } from './daemon'

describe('board state files', () => {
  let dir: string
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'bd-board-state-'))
  })
  afterEach(() => rmSync(dir, { recursive: true, force: true }))

  const board = (pid: number) => ({ pid, port: 1338, url: 'http://127.0.0.1:1338/', repo: '/repo/a' })

  it('prefers the runtime dir and falls back to tmp', () => {
    expect(stateDir({ XDG_RUNTIME_DIR: '/run/user/1' })).toBe('/run/user/1/bd-board')
    expect(stateDir({})).toBe(join(tmpdir(), 'bd-board'))
  })

  it('keys each repo path to its own file', () => {
    expect(stateStem('/repo/a', dir)).not.toBe(stateStem('/repo/b', dir))
    expect(stateStem('/repo/a', dir)).toBe(stateStem('/repo/a', dir))
  })

  it('reads back a live board and ignores other repos', () => {
    writeState(board(process.pid), dir)
    expect(readState('/repo/a', dir)).toEqual(board(process.pid))
    expect(readState('/repo/b', dir)).toBeNull()
  })

  it('drops a state file whose process is gone', () => {
    writeState(board(2 ** 22 + 7), dir)
    expect(readState('/repo/a', dir)).toBeNull()
    expect(readdirSync(dir)).toEqual([])
  })

  it('clears only the file that names the exiting pid', () => {
    writeState(board(process.pid), dir)
    clearState('/repo/a', process.pid + 1, dir)
    expect(readState('/repo/a', dir)).not.toBeNull()
    clearState('/repo/a', process.pid, dir)
    expect(readdirSync(dir)).toEqual([])
  })
})
