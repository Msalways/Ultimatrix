/**
 * Phase B (Jarvis Lethality Program, spec 01) — brain lethality guards.
 *
 * Locks: OODA hunting mandate present; [PATH:] contract restored on the
 * solver path; shared evidence/assumption discipline composed from
 * CORE_CONTRACT (single source); runtime envelope carries actionable alert
 * guidance, bounded blackboard facts, and captured-traffic awareness.
 */
import { describe, it, expect } from 'vitest'
import { getBrainInstructions } from '../../src/solver/brain-instructions'
import { CORE_CONTRACT, EVIDENCE_DISCIPLINE, ASSUMPTION_VERIFICATION } from '../../src/prompts/core-contract'
import { TOOL_IDS } from '../../src/mastra/tools'
import { buildRuntimeEnvelope } from '../../src/runtime/context-envelope'
import { Blackboard } from '../../src/core/blackboard'
import { getCapturedRequestStore } from '../../src/capture/captured-request-store'

// Brain instructions may mention these tool names as examples of what NOT to use
const ALLOWED_TOOL_MENTIONS = new Set(['listTools', 'loadTool'])
const FILTERED_TOOL_IDS = TOOL_IDS.filter(id => !ALLOWED_TOOL_MENTIONS.has(id))
const TOOL_RE = new RegExp(`\\b(${FILTERED_TOOL_IDS.join('|')})\\b`)

describe('brain instructions — hunting mandate', () => {
  const prompt = getBrainInstructions({} as any)

  it('declares the offensive objective', () => {
    expect(prompt).toMatch(/objective is confirmed, evidenced vulnerability findings/i)
    expect(prompt).toMatch(/observe, react, or attack/i)
  })

  it('teaches the observe-react-attack loop with consequence inspection', () => {
    expect(prompt).toMatch(/OBSERVE first/i)
    expect(prompt).toMatch(/REACT after every action/i)
    expect(prompt).toMatch(/ATTACK deliberately/i)
    expect(prompt).toMatch(/Never fire actions blindly in sequence/i)
  })

  it('restores the [PATH:] declaration contract (anti-loop participation)', () => {
    expect(prompt).toMatch(/\[PATH: <class>\]/)
    expect(prompt).toMatch(/anti-loop system tracks these tags/)
  })

  it('carries the path-diversity rule', () => {
    expect(prompt).toMatch(/fundamentally different approaches/i)
  })

  it('names no concrete tool ids', () => {
    expect(prompt).not.toMatch(TOOL_RE)
  })

  it('stays within the word budget (~850 words)', () => {
    const words = prompt.split(/\s+/).length
    expect(words).toBeLessThan(900)
  })
})

describe('shared discipline sections (single source)', () => {
  it('exports EVIDENCE_DISCIPLINE consumed by BOTH brain prompt and CORE_CONTRACT', () => {
    expect(getBrainInstructions({} as any)).toContain(EVIDENCE_DISCIPLINE)
    expect(CORE_CONTRACT).toContain(EVIDENCE_DISCIPLINE)
  })

  it('exports ASSUMPTION_VERIFICATION consumed by BOTH brain prompt and CORE_CONTRACT', () => {
    expect(getBrainInstructions({} as any)).toContain(ASSUMPTION_VERIFICATION)
    expect(CORE_CONTRACT).toContain(ASSUMPTION_VERIFICATION)
  })

  it('shared sections name no concrete tool ids either', () => {
    expect(EVIDENCE_DISCIPLINE).not.toMatch(TOOL_RE)
    expect(ASSUMPTION_VERIFICATION).not.toMatch(TOOL_RE)
  })
})

describe('runtime envelope enrichment', () => {
  it('pairs each alert with typed remediation guidance', () => {
    const out = buildRuntimeEnvelope({
      target: 'https://t.example',
      contextWindow: 128_000,
      alerts: [
        { type: 'stale-execution', count: 3 },
        { type: 'unsupported-claims', count: 1 },
      ],
    })
    expect(out).toContain('"guidance"')
    expect(out).toMatch(/Switch to a fundamentally different attack class/)
    expect(out).toMatch(/Re-verify them against captured facts or retract/)
  })

  it('surfaces bounded recent blackboard facts alongside plan refs', () => {
    const board = new Blackboard({ origin: 'https://t.example', goal: 'g' })
    board.addFact('Attack path: /login -> /admin (high, 2 hops)', 'finding')
    const out = buildRuntimeEnvelope({
      target: 'https://t.example',
      contextWindow: 128_000,
      blackboard: board,
      blackboardFacts: { total: board.getFactStrings().length, recent: board.getFactStrings().slice(-8) },
    })
    expect(out).toMatch(/Attack path: \/login -> \/admin/)
    expect(out).toMatch('"total"')
  })

  it('exposes captured-request awareness for the replay seam', () => {
    const store = getCapturedRequestStore()
    store.clear()
    store.record({ method: 'GET', url: 'https://t.example/a' })
    const out = buildRuntimeEnvelope({
      target: 'https://t.example',
      contextWindow: 128_000,
      capturedRequests: { total: store.size },
    })
    expect(out).toMatch(/replayable with structural mutations/)
    store.clear()
  })

  it('omits facts/capture content when not provided (backward compatible)', () => {
    const out = buildRuntimeEnvelope({ target: 'https://t.example', contextWindow: 128_000 })
    expect(out).toContain('"capture":null')
    expect(out).toContain('"facts":null')
    expect(out).not.toMatch(/replayable with structural mutations/)
    expect(out).not.toContain('"guidance"')
  })
})
