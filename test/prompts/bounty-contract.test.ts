/**
 * Bounty engagement contract guards.
 *
 * Locks: the bounty block is composed ONLY under the live profile; the default
 * lab prompt is unchanged; every section loads non-empty (a CRLF extraction
 * failure must not silently ship an unguarded brain); no concrete tool ids; and
 * each section leads with a load-bearing headline, because the adaptive
 * compressor keeps only the first line of a section.
 */
import { describe, it, expect, afterEach } from 'vitest'
import { getBrainInstructions } from '../../src/solver/brain-instructions'
import {
  BOUNTY_CONTRACT,
  BOUNTY_PROGRAM_RULES,
  BOUNTY_TRIAGE,
  BOUNTY_IMPACT_DISCIPLINE,
  BOUNTY_REPORTABILITY,
  BOUNTY_CONTINUATION,
  bountyContractBlock,
} from '../../src/prompts/bounty-contract'
import { compressBrainInstructions, planAdaptiveContext } from '../../src/models/adaptive-context'
import { TOOL_IDS } from '../../src/mastra/tools'
import { __setTestFallback } from '../../src/runtime/engagement-context'

const ALLOWED_TOOL_MENTIONS = new Set(['listTools', 'loadTool'])
const TOOL_RE = new RegExp(`\\b(${TOOL_IDS.filter(id => !ALLOWED_TOOL_MENTIONS.has(id)).join('|')})\\b`)

function bountyServices() {
  return { bountyEnabled: true } as any
}

describe('bounty engagement contract', () => {
  afterEach(() => __setTestFallback(null))

  it('loads every section non-empty (guards the CRLF extraction trap)', () => {
    for (const section of [BOUNTY_PROGRAM_RULES, BOUNTY_TRIAGE, BOUNTY_IMPACT_DISCIPLINE, BOUNTY_REPORTABILITY, BOUNTY_CONTINUATION]) {
      expect(section.length).toBeGreaterThan(120)
    }
    expect(bountyContractBlock()).not.toBe('')
    expect(BOUNTY_CONTRACT).toContain('### Impact Discipline')
  })

  it('is absent from the default lab prompt', () => {
    const prompt = getBrainInstructions({} as any)
    expect(prompt).not.toContain('Live bounty engagement')
    expect(prompt).not.toContain(BOUNTY_TRIAGE)
  })

  it('is composed when the engagement owns the live bounty profile', () => {
    __setTestFallback(bountyServices())
    const prompt = getBrainInstructions({} as any)
    expect(prompt).toContain('Live bounty engagement')
    expect(prompt).toContain(BOUNTY_IMPACT_DISCIPLINE)
  })

  it('is composed when the passed config declares the profile', () => {
    const prompt = getBrainInstructions({ bounty: { enabled: true } } as any)
    expect(prompt).toContain('Live bounty engagement')
  })

  it('teaches program rules before attacking', () => {
    const prompt = getBrainInstructions({ bounty: { enabled: true } } as any)
    expect(prompt).toMatch(/before proposing an attack, establish the engagement's own rules/i)
    expect(prompt).toMatch(/prohibitions as inviolable/i)
  })

  it('ranks by expected value instead of treating classes as equal', () => {
    const prompt = getBrainInstructions({ bounty: { enabled: true } } as any)
    expect(prompt).toMatch(/expected value/i)
    expect(prompt).toMatch(/depth over breadth/i)
  })

  it('prioritises structural properties rather than a frozen technique list', () => {
    // Naming a fixed catalogue of vulnerability classes is exactly the rigidity
    // failure the project forbids; the brain must discover the live taxonomy.
    expect(BOUNTY_TRIAGE).toMatch(/structural\*?\*?\s+properties rather than a memorized list/i)
    expect(BOUNTY_TRIAGE).toMatch(/never recite a fixed catalogue/i)
  })

  it('constrains impact so a run cannot burn the program relationship', () => {
    const prompt = getBrainInstructions({ bounty: { enabled: true } } as any)
    expect(prompt).toMatch(/denial-of-service/i)
    expect(prompt).toMatch(/never establish persistence/i)
    expect(prompt).toMatch(/never run credential attacks/i)
    expect(prompt).toMatch(/minimum impact/i)
  })

  it('requires novelty and third-party reproducibility before promotion', () => {
    const prompt = getBrainInstructions({ bounty: { enabled: true } } as any)
    expect(prompt).toMatch(/reproduce it from written steps/i)
    expect(prompt).toMatch(/novelty/i)
  })

  it('tells the brain to stop and report rather than churn', () => {
    const prompt = getBrainInstructions({ bounty: { enabled: true } } as any)
    expect(prompt).toMatch(/Stop and report honestly/i)
  })

  it('leads each section with its load-bearing headline', () => {
    // The adaptive compressor keeps only the first line of each ### section, so
    // the first line must be the rule that matters most.
    const headline = (section: string) => section.split('\n').map(l => l.trim()).find(l => l.length > 0) ?? ''
    expect(headline(BOUNTY_TRIAGE)).toMatch(/expected value/i)
    expect(headline(BOUNTY_IMPACT_DISCIPLINE)).toMatch(/minimize impact/i)
    expect(headline(BOUNTY_CONTINUATION)).toMatch(/continue while/i)
  })

  it('survives compression with its headlines intact', () => {
    const full = getBrainInstructions({ bounty: { enabled: true } } as any)
    const compressed = compressBrainInstructions(full, planAdaptiveContext({
      contextWindow: 8192,
      systemPromptTokens: 9000,
      toolSchemasTokens: 3000,
      goalTokens: 200,
      reservedOutputTokens: 2048,
    }))
    expect(compressed).toMatch(/minimize impact/i)
    expect(compressed).toMatch(/expected value/i)
  })

  it('names no concrete tool ids', () => {
    expect(BOUNTY_CONTRACT).not.toMatch(TOOL_RE)
  })

  it('stays within a sane word budget', () => {
    // The contract is a deliberate, mode-only cost: bounty engagements trade
    // prompt budget for triage and impact discipline, and adaptive compression
    // trims under per-model pressure. The cap that matters is the CONTRACT's own
    // size, asserted separately so it cannot quietly grow, plus a total bound so
    // the whole prompt stays proportionate to the base (~1200 words).
    const contractWords = BOUNTY_CONTRACT.split(/\s+/).length
    expect(contractWords).toBeLessThan(900)

    const words = getBrainInstructions({ bounty: { enabled: true } } as any).split(/\s+/).length
    expect(words).toBeLessThan(2100)
  })
})
