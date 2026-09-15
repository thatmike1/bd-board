import { describe, expect, it } from 'vitest'
import { parseOptions, repoNameFromId, resolveActor } from './main'

describe('cli flags', () => {
  it('defaults port and opening the browser, leaving agentsview undefined', () => {
    const options = parseOptions([])
    expect(options.port).toBe(1338)
    expect(options.agentsview).toBeUndefined()
    expect(options.open).toBe(true)
    expect(options.repo).toBe(process.cwd())
  })

  it('reads every flag from the contract including --config', () => {
    const options = parseOptions([
      '--repo',
      '/tmp',
      '--port',
      '4198',
      '--config',
      '/tmp/custom.json',
      '--agentsview',
      'http://x:1',
      '--no-open',
    ])
    expect(options).toEqual({
      repo: '/tmp',
      port: 4198,
      config: '/tmp/custom.json',
      agentsview: 'http://x:1',
      open: false,
    })
  })

  it('turns the session join off with --no-agentsview', () => {
    expect(parseOptions(['--no-agentsview']).agentsview).toBeNull()
  })

  it('rejects a port outside the range and an unknown flag', () => {
    expect(() => parseOptions(['--port', '99999'])).toThrow()
    expect(() => parseOptions(['--wat'])).toThrow()
  })
})

describe('repo name', () => {
  it('is the bd prefix of an exported id', () => {
    expect(repoNameFromId('demo-project-9fz')).toBe('demo-project')
    expect(repoNameFromId('demo-project-zf8.4')).toBe('demo-project')
    expect(repoNameFromId('bd-123')).toBe('bd')
    expect(repoNameFromId('lonely')).toBeNull()
  })
})

describe('actor resolution', () => {
  it('returns $BEADS_ACTOR when set', () => {
    const prev = process.env['BEADS_ACTOR']
    try {
      process.env['BEADS_ACTOR'] = 'alice'
      expect(resolveActor(process.cwd())).toBe('alice')
    } finally {
      if (prev === undefined) delete process.env['BEADS_ACTOR']
      else process.env['BEADS_ACTOR'] = prev
    }
  })
})
