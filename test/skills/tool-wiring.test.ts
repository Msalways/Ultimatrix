import { describe, it, expect, beforeEach } from 'vitest'
import { initSkillIndex, resetSharedSkillIndex } from '../../src/solver/skills/loader'
import { TOOL_IDS } from '../../src/mastra/tools'
import { personaMetadataFor } from '../../src/council/personas'

const TOOL_ID_SET = new Set<string>(TOOL_IDS)

beforeEach(() => {
  resetSharedSkillIndex()
})

describe('skill -> tool wiring (data-driven, no prompt hardcoding)', () => {
  it('active-testing skills declare runPrimitive', () => {
    const ids = [
      'exploitation',
      'vuln-discovery',
      'second-order-sqli',
      'ssti',
      'nosql-injection',
      'command-injection-advanced',
      'email-injection',
      'xxe',
      'authorization',
      'modern-xss',
    ]
    for (const id of ids) {
      const skill = initSkillIndex().get(id)
      expect(skill, `skill ${id} should exist`).toBeDefined()
      expect(skill!.toolRefs, `skill ${id} toolRefs`).toContain('runPrimitive')
    }
  })

  it('systematic-coverage skills declare runCampaign', () => {
    for (const id of ['web-pentest', 'business-logic']) {
      const skill = initSkillIndex().get(id)
      expect(skill, `skill ${id} should exist`).toBeDefined()
      expect(skill!.toolRefs, `skill ${id} toolRefs`).toContain('runCampaign')
    }
  })

  it('every skill toolRef resolves to a real registered tool id', () => {
    for (const skill of initSkillIndex().values()) {
      for (const t of skill.toolRefs) {
        expect(
          TOOL_ID_SET.has(t),
          `skill ${skill.id} references unknown tool "${t}"`,
        ).toBe(true)
      }
    }
  })

  it('runPrimitive/runCampaign are registered tool ids', () => {
    expect(TOOL_ID_SET.has('runPrimitive')).toBe(true)
    expect(TOOL_ID_SET.has('runCampaign')).toBe(true)
  })

  it('council operator allow-list includes the evidence-gated primitives', () => {
    const meta = personaMetadataFor('operator')
    const restrictions = Array.isArray(meta.toolRestrictions)
      ? meta.toolRestrictions
      : meta.toolRestrictions
        ? [meta.toolRestrictions]
        : []
    expect(restrictions).toContain('runPrimitive')
    expect(restrictions).toContain('runCampaign')
  })
})
