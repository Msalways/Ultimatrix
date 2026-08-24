/**
 * Phase D — skill import validation gate (spec 04 D5).
 *
 * The P0 stripped-skills defect is structurally rejected at the door:
 * incomplete frontmatter, unknown toolRefs/primitives, empty or unclosed
 * fenced blocks, and name mismatches all fail closed with precise errors.
 */
import { describe, it, expect } from 'vitest'

const VALID_SKILL = `---
name: test-skill
description: "A valid test skill with payloads"
category: test
tier: fast
toolRefs: [httpRequest, parseResponse]
primitives: [classicInjection]
triggers: ["test trigger"]
---

# Test Skill

## Payload

\`\`\`http
GET /search?q=' OR '1'='1 HTTP/1.1
Host: target.example
\`\`\`
`

describe('validateSkillMarkdown', () => {
  it('accepts a complete, wired skill', async () => {
    const { validateSkillMarkdown } = await import('../../src/solver/skills/validate')
    const result = validateSkillMarkdown(VALID_SKILL, 'test-skill')
    expect(result.valid).toBe(true)
    expect(result.meta?.name).toBe('test-skill')
    expect(result.meta?.primitives).toEqual(['classicInjection'])
  })

  it('rejects missing frontmatter', async () => {
    const { validateSkillMarkdown } = await import('../../src/solver/skills/validate')
    const result = validateSkillMarkdown('# Just prose\n\nNo fences, no frontmatter.')
    expect(result.valid).toBe(false)
    expect(result.errors[0]).toMatch(/frontmatter/i)
  })

  it('rejects missing required fields', async () => {
    const { validateSkillMarkdown } = await import('../../src/solver/skills/validate')
    const result = validateSkillMarkdown('---\ntier: fast\n---\n\nbody\n')
    expect(result.errors.some(e => e.includes('name'))).toBe(true)
    expect(result.errors.some(e => e.includes('description'))).toBe(true)
  })

  it('rejects folder-name mismatch', async () => {
    const { validateSkillMarkdown } = await import('../../src/solver/skills/validate')
    const result = validateSkillMarkdown(VALID_SKILL, 'other-folder-name')
    expect(result.valid).toBe(false)
    expect(result.errors.join(' ')).toMatch(/does not match/)
  })

  it('rejects unknown toolRefs', async () => {
    const { validateSkillMarkdown } = await import('../../src/solver/skills/validate')
    const bad = VALID_SKILL.replace('toolRefs: [httpRequest, parseResponse]', 'toolRefs: [httpRequest, notATool]')
    const result = validateSkillMarkdown(bad)
    expect(result.valid).toBe(false)
    expect(result.errors.join(' ')).toMatch(/unknown tool: notATool/)
  })

  it('rejects unknown primitives', async () => {
    const { validateSkillMarkdown } = await import('../../src/solver/skills/validate')
    const bad = VALID_SKILL.replace('primitives: [classicInjection]', 'primitives: [notAPrimitive]')
    const result = validateSkillMarkdown(bad)
    expect(result.valid).toBe(false)
    expect(result.errors.join(' ')).toMatch(/unknown primitive: notAPrimitive/)
  })

  it('strips BOM before parsing', async () => {
    const { validateSkillMarkdown } = await import('../../src/solver/skills/validate')
    const result = validateSkillMarkdown('\uFEFF' + VALID_SKILL)
    expect(result.valid).toBe(true)
  })

  it('REJECTS the P0 failure mode: payload-stripped skills (empty fences)', async () => {
    const { validateSkillMarkdown } = await import('../../src/solver/skills/validate')
    // Exactly what the audit found: heading followed by blank fenced blocks.
    const stripped = `---
name: stripped-skill
description: "Looks fine but the payloads were removed"
---

## Universal Polyglots

\`\`\`

\`\`\`

## RCE Chains

\`\`\`

\`\`\`
`
    const result = validateSkillMarkdown(stripped)
    expect(result.valid).toBe(false)
    expect(result.errors.join(' ')).toMatch(/empty fenced block/i)
  })

  it('rejects skills with no fenced content at all', async () => {
    const { validateSkillMarkdown } = await import('../../src/solver/skills/validate')
    const result = validateSkillMarkdown('---\nname: x\ndescription: "y"\n---\n\nJust prose.\n')
    expect(result.valid).toBe(false)
    expect(result.errors.join(' ')).toMatch(/no fenced content blocks/i)
  })

  it('rejects unclosed fences', async () => {
    const { validateSkillMarkdown } = await import('../../src/solver/skills/validate')
    const trimmed = VALID_SKILL.trimEnd()
    const unclosed = trimmed.slice(0, trimmed.length - 3) // drop the closing ```
    const result = validateSkillMarkdown(unclosed)
    expect(result.valid).toBe(false)
    expect(result.errors.join(' ')).toMatch(/unclosed code fence/i)
  })

  it('rejects oversized imports (DoS guard)', async () => {
    const { validateSkillMarkdown } = await import('../../src/solver/skills/validate')
    const huge = VALID_SKILL + '\n'.repeat(300 * 1024)
    const result = validateSkillMarkdown(huge)
    expect(result.valid).toBe(false)
    expect(result.errors.join(' ')).toMatch(/exceeds/)
  })
})
