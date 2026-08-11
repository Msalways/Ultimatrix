/**
 * GlobalMemoryStore tests — Slice 11. Proves the gated global-write path:
 * safe preferences persist and round-trip; workflow-scoped kinds are rerouted
 * (never persisted); target-sensitive values throw MemoryPolicyError (fail
 * closed); every write is recorded on the DecisionLedger.
 */

import { describe, expect, it, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, existsSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { GlobalMemoryStore } from '../../src/memory/global-store'
import { MemoryPolicyError } from '../../src/memory/policy'
import { getGlobalDecisionLedger } from '../../src/security/decision-ledger'

const JWT = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U'

let dir: string

function tempStore(): GlobalMemoryStore {
  dir = mkdtempSync(join(tmpdir(), 'ultimatrix-global-store-'))
  return new GlobalMemoryStore({ path: join(dir, 'global-preferences.json') })
}

beforeEach(() => {
  getGlobalDecisionLedger().clear()
})

afterEach(() => {
  if (dir) rmSync(dir, { recursive: true, force: true })
})

describe('GlobalMemoryStore', () => {
  it('persists a safe preference and round-trips it', async () => {
    const store = tempStore()
    const result = await store.writePreference('theme', { dark: true })
    expect(result.allowed).toBe(true)
    expect(result.destination).toBe('global')

    const reloaded = new GlobalMemoryStore({ path: store.getPath() })
    const prefs = await reloaded.readPreferences()
    expect(prefs).toEqual({ theme: { dark: true } })
  })

  it('reroutes workflow-scoped writes to project and does NOT persist', async () => {
    const store = tempStore()
    const result = await store.write({ scope: 'global', kind: 'target_data', value: { url: 'https://example.com/x' } })
    expect(result.allowed).toBe(true)
    expect(result.destination).toBe('project')
    expect(existsSync(store.getPath())).toBe(false)
  })

  it('blocks a target-sensitive preference and never persists it', async () => {
    const store = tempStore()
    await store.writePreference('theme', 'dark')
    await expect(store.writePreference('credential', { apiKey: JWT })).rejects.toThrow(MemoryPolicyError)
    await expect(store.writePreference('endpoint', 'https://example.com/api/users')).rejects.toThrow(MemoryPolicyError)

    const reloaded = new GlobalMemoryStore({ path: store.getPath() })
    const prefs = await reloaded.readPreferences()
    expect(prefs).toEqual({ theme: 'dark' })
    expect(prefs.credential).toBeUndefined()
    expect(prefs.endpoint).toBeUndefined()
  })

  it('records every policy decision on the ledger', async () => {
    const store = tempStore()
    await store.writePreference('verbosity', 2)
    await expect(store.writePreference('apiKey', 'sk_live_abc')).rejects.toThrow(MemoryPolicyError)

    const decisions = getGlobalDecisionLedger().listDecisions('memory.policy')
    expect(decisions.length).toBe(2)
    expect(decisions.some(d => d.reason.includes('blocked'))).toBe(true)
    expect(decisions.some(d => d.reason.includes('safe'))).toBe(true)
  })
})

describe('GlobalMemoryStore on-disk shape', () => {
  it('stores a versioned file under the given path', async () => {
    const store = tempStore()
    await store.writePreference('reduced-motion', true)
    const raw = JSON.parse(readFileSync(store.getPath(), 'utf-8')) as { version: number; preferences: Record<string, unknown> }
    expect(raw.version).toBe(1)
    expect(raw.preferences).toEqual({ 'reduced-motion': true })
  })
})
