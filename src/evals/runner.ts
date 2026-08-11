/**
 * Eval runner — Slice 12.
 *
 * Runs an `ArchitectureEvalCase` and checks two contracts:
 *   1. Event order: every `expectedEvents` entry appears in the emitted stream
 *      in the same relative order (subsequence match — a vertical flow can
 *      legally emit extra events between the asserted ones).
 *   2. Final state: every `expectedState` key deep-equals the produced state
 *      (subset match — extra keys are fine, asserted keys must be exact).
 *
 * A case passes only when BOTH hold; failures are collected per case so a
 * broken vertical flow reports exactly which assertions it violated.
 */

import type { ArchitectureEvalCase, ArchitectureEvalResult, ArchitectureEvalSuite } from './types'

function isEqual(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true
  if (typeof a !== typeof b) return false
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false
    return a.every((v, i) => isEqual(v, b[i]))
  }
  if (a && b && typeof a === 'object' && typeof b === 'object') {
    const ka = Object.keys(a as Record<string, unknown>)
    const kb = Object.keys(b as Record<string, unknown>)
    if (ka.length !== kb.length) return false
    return ka.every((k) => isEqual((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]))
  }
  return false
}

/** Order-preserving subsequence match of `expected` inside `actual`. */
function eventsInOrder(actual: string[], expected: string[]): { ok: boolean; missing: string[] } {
  const missing: string[] = []
  let cursor = 0
  for (const name of expected) {
    const idx = actual.indexOf(name, cursor)
    if (idx === -1) {
      missing.push(name)
    } else {
      cursor = idx + 1
    }
  }
  return { ok: missing.length === 0, missing }
}

export async function runEvalCase(caseDef: ArchitectureEvalCase): Promise<ArchitectureEvalResult> {
  const startedAt = Date.now()
  const failures: string[] = []
  let events: string[] = []
  let state: Record<string, unknown> = {}

  try {
    const output = await caseDef.execute()
    events = output.events
    state = output.state

    const order = eventsInOrder(events, caseDef.expectedEvents)
    if (!order.ok) {
      failures.push(`event order: expected ${order.missing.join(', ')} (in order), emitted: ${events.join(' -> ')}`)
    }

    for (const [key, expected] of Object.entries(caseDef.expectedState)) {
      if (!(key in state)) {
        failures.push(`state.${key}: missing (expected ${JSON.stringify(expected)})`)
        continue
      }
      if (!isEqual(state[key], expected)) {
        failures.push(`state.${key}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(state[key])}`)
      }
    }
  } catch (err) {
    failures.push(`execute threw: ${err instanceof Error ? err.message : String(err)}`)
  }

  return {
    caseId: caseDef.id,
    passed: failures.length === 0,
    failures,
    durationMs: Date.now() - startedAt,
  }
}

export async function runEvalSuite(suite: ArchitectureEvalSuite): Promise<ArchitectureEvalResult[]> {
  const results: ArchitectureEvalResult[] = []
  for (const caseDef of suite.cases) {
    results.push(await runEvalCase(caseDef))
  }
  return results
}
