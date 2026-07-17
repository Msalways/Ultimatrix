import { describe, it, expect } from 'vitest'
import { resolveEnvVars } from '../../src/extensions/resolve-env'

describe('resolveEnvVars', () => {
  it('interpolates ${VAR} from provided env map', () => {
    const out = resolveEnvVars({ url: 'https://${HOST}/api', token: '${TOKEN}' }, { HOST: 'example.com', TOKEN: 'abc' })
    expect(out).toEqual({ url: 'https://example.com/api', token: 'abc' })
  })

  it('interpolates nested structures and arrays', () => {
    const out = resolveEnvVars({ env: { KEY: '${K}' }, list: ['${A}', '${B}'] }, { K: '1', A: 'x', B: 'y' })
    expect(out).toEqual({ env: { KEY: '1' }, list: ['x', 'y'] })
  })

  it('replaces unknown vars with empty string', () => {
    const out = resolveEnvVars('${MISSING}', { OTHER: '1' })
    expect(out).toBe('')
  })

  it('leaves string without tokens unchanged', () => {
    expect(resolveEnvVars('plain', {})).toBe('plain')
  })
})
