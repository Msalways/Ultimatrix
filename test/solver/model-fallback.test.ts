import { describe, it, expect } from 'vitest'
import {
  MAX_MODEL_ATTEMPTS,
  isRecoverableModelFailure,
  modelKey,
  nextConfiguredModel,
  resolveProgressTimeoutMs,
} from '../../src/solver/model-fallback'

describe('resolveProgressTimeoutMs', () => {
  it('scales with the turn budget instead of the old fixed 60s cap', () => {
    // Default 5-minute turn: quarter budget = 75s
    expect(resolveProgressTimeoutMs(300_000)).toBe(75_000)
    // 30-minute turn (live ultimatrix.yaml): capped at 180s per gap
    expect(resolveProgressTimeoutMs(1_800_000)).toBe(180_000)
  })

  it('floors short turns at 60s to preserve previous behavior', () => {
    expect(resolveProgressTimeoutMs(30_000)).toBe(60_000)
    expect(resolveProgressTimeoutMs(0)).toBe(75_000)
  })

  it('honors an explicit override, floored at 15s', () => {
    expect(resolveProgressTimeoutMs(1_800_000, 240_000)).toBe(240_000)
    expect(resolveProgressTimeoutMs(1_800_000, 1_000)).toBe(15_000)
    expect(resolveProgressTimeoutMs(1_800_000, 0)).toBe(180_000)
    expect(resolveProgressTimeoutMs(1_800_000, -5)).toBe(180_000)
  })
})

describe('isRecoverableModelFailure', () => {
  it('treats stream stalls as recoverable', () => {
    expect(isRecoverableModelFailure({
      reason: 'model_failed',
      error: 'Model progress stalled: Model progress watchdog expired after 60000ms. Partial research state was preserved; retry or switch model/provider.',
    })).toBe(true)
    expect(isRecoverableModelFailure({ reason: 'model_failed', error: 'Model stream startup timed out after 60000ms' })).toBe(true)
    expect(isRecoverableModelFailure({ reason: 'model_failed', error: 'Model transport failed: Cannot connect to API: Headers Timeout Error' })).toBe(true)
    expect(isRecoverableModelFailure({ reason: 'model_failed', error: 'fetch failed' })).toBe(true)
  })

  it('treats overload/rate-limit/transport errors as recoverable', () => {
    expect(isRecoverableModelFailure({ reason: 'model_failed', error: '503 service_unavailable' })).toBe(true)
    expect(isRecoverableModelFailure({ reason: 'model_failed', error: 'Rate limited by provider' })).toBe(true)
    expect(isRecoverableModelFailure({ reason: 'model_failed', error: 'cannot connect to provider' })).toBe(true)
  })

  it('rejects non-model reasons and unknown model errors', () => {
    expect(isRecoverableModelFailure({ reason: 'stale' })).toBe(false)
    expect(isRecoverableModelFailure({ reason: 'frontier_exhausted' })).toBe(false)
    expect(isRecoverableModelFailure({ reason: 'model_failed', error: 'exploded on purpose' })).toBe(false)
    expect(isRecoverableModelFailure({ reason: 'model_failed' })).toBe(false)
  })
})

describe('nextConfiguredModel', () => {
  const config = {
    provider: 'nvidia',
    model: 'nvidia/nemotron-3.5-lightning-30b-a3b',
    modelTiers: {
      fast: { provider: 'nvidia', model: 'nvidia/nemotron-3.5-lightning-30b-a3b' },
      balanced: { provider: 'nvidia', model: 'nvidia/nemotron-3-ultra-550b-a55b' },
      powerful: { provider: 'nvidia', model: 'nvidia/nemotron-3-ultra-550b-a55b' },
    },
    modelRoleTiers: { brain: 'fast' },
  }

  it('walks to the next unattempted tier (fast -> balanced/powerful)', () => {
    const attempted = new Set(['nvidia/nemotron-3.5-lightning-30b-a3b'])
    const next = nextConfiguredModel(config, { provider: 'nvidia', model: 'nemotron-3.5-lightning-30b-a3b' }, attempted)
    expect(next).toEqual({ provider: 'nvidia', model: 'nvidia/nemotron-3-ultra-550b-a55b', key: 'nvidia/nemotron-3-ultra-550b-a55b' })
  })

  it('returns undefined when every candidate is attempted', () => {
    const attempted = new Set([
      'nvidia/nemotron-3.5-lightning-30b-a3b',
      'nvidia/nemotron-3-ultra-550b-a55b',
    ])
    expect(nextConfiguredModel(config, { provider: 'nvidia', model: 'x' }, attempted)).toBeUndefined()
  })

  it('skips quota-exhausted providers instead of burning a doomed turn', () => {
    const attempted = new Set(['nvidia/nemotron-3.5-lightning-30b-a3b'])
    // nvidia tapped out entirely: no fallback even though ultra is unattempted.
    expect(nextConfiguredModel(
      config,
      { provider: 'nvidia', model: 'nemotron-3.5-lightning-30b-a3b' },
      attempted,
      () => true,
    )).toBeUndefined()
    // Only the current provider exhausted: ultra is also nvidia, still skipped.
    // With a healthy second provider configured, it would be selected.
    const multi = {
      ...config,
      modelTiers: {
        ...config.modelTiers,
        powerful: { provider: 'openrouter', model: 'some-model' },
      },
    }
    expect(nextConfiguredModel(
      multi,
      { provider: 'nvidia', model: 'nemotron-3.5-lightning-30b-a3b' },
      attempted,
      (provider) => provider === 'nvidia',
    )).toEqual({ provider: 'openrouter', model: 'some-model', key: 'openrouter/some-model' })
  })

  it('treats a broken gate as no filtering (per-call enforcement still applies)', () => {
    const attempted = new Set(['nvidia/nemotron-3.5-lightning-30b-a3b'])
    const next = nextConfiguredModel(
      config,
      { provider: 'nvidia', model: 'nemotron-3.5-lightning-30b-a3b' },
      attempted,
      () => { throw new Error('gate down') },
    )
    expect(next).toEqual({ provider: 'nvidia', model: 'nvidia/nemotron-3-ultra-550b-a55b', key: 'nvidia/nemotron-3-ultra-550b-a55b' })
  })

  it('bounds turn retries', () => {
    expect(MAX_MODEL_ATTEMPTS).toBe(2)
  })

  it('never retries the same model when YAML carries a provider-prefixed id', () => {
    // Live bug: resolveModelRef returns the raw (prefixed) YAML value, so a
    // naive `${provider}/${model}` seed becomes `nvidia/nvidia/...`, the
    // attempted-set dedup misses, and the "fallback" rebuilds the same
    // dead model. Seeds must go through modelKey like the candidates do.
    const seed = modelKey('nvidia', 'nvidia/nemotron-3.5-lightning-30b-a3b')
    expect(seed).toBe('nvidia/nemotron-3.5-lightning-30b-a3b')
    const attempted = new Set([seed])
    const next = nextConfiguredModel(
      config,
      { provider: 'nvidia', model: 'nvidia/nemotron-3.5-lightning-30b-a3b' },
      attempted,
    )
    expect(next).toEqual({ provider: 'nvidia', model: 'nvidia/nemotron-3-ultra-550b-a55b', key: 'nvidia/nemotron-3-ultra-550b-a55b' })
  })
})
