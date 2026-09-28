/**
 * Model failure classification + transport retry policy.
 *
 * Locks: terminal conditions (bad key / 403 / unsupported model) are never
 * retried blindly, and genuinely recoverable ones still are — so removing the
 * transport-level retry loop cannot silently disable real resilience.
 */
import { describe, it, expect } from 'vitest'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { isRecoverableModelFailure } from '../../src/solver/model-fallback'

describe('model failure classification', () => {
  it('treats an auth failure as terminal (no blind retry, no tier churn)', () => {
    // The same dead key fails identically on every model behind that provider,
    // so escalating the tier ladder cannot rescue it. Report and stop.
    for (const message of [
      'Authentication failed for nvidia: Forbidden. Check nvidia in the project providers.yaml',
      '401 Unauthorized',
      '403 Forbidden',
      'invalid api key',
    ]) {
      expect(isRecoverableModelFailure({ reason: 'model_failed', error: message })).toBe(false)
    }
  })

  it('treats an unavailable model as recoverable at the tier level', () => {
    // Deliberate, bounded escalation: a different CONFIGURED model may work, so
    // this is worth one retry via nextConfiguredModel. It is not a blind
    // same-request retry — that is what maxRetries: 0 removes.
    expect(isRecoverableModelFailure({ reason: 'model_failed', error: 'model not found' })).toBe(true)
    expect(isRecoverableModelFailure({ reason: 'model_failed', error: 'unsupported model' })).toBe(true)
  })

  it('still treats transient conditions as recoverable so escalation works', () => {
    for (const message of [
      '503 service_unavailable',
      '429 rate limit exceeded',
      '500 internal error',
      'fetch failed',
      'connection refused',
      'econnreset',
      'stream startup timed out',
    ]) {
      expect(isRecoverableModelFailure({ reason: 'model_failed', error: message })).toBe(true)
    }
  })

  it('ignores non-model_failed reasons', () => {
    expect(isRecoverableModelFailure({ reason: 'other', error: '503' })).toBe(false)
  })

  it('disables transport-level retries on the solver brain', async () => {
    const source = await readFile(join(process.cwd(), 'src/solver/brain-tools.ts'), 'utf-8')
    const agentBlock = source.slice(source.indexOf('new Agent({'))
    expect(agentBlock).toMatch(/maxRetries:\s*0/)
  })
})
