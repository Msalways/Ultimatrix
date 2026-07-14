import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync } from 'fs'
import { join } from 'path'
import { TOOL_IDS } from '../../src/mastra/tools'
import { getBrainInstructions } from '../../src/solver/brain-instructions'
import { CORE_CONTRACT } from '../../src/prompts/core-contract'

// Build a word-boundary regex over every registered tool id. The system prompt
// must never name a concrete tool — skills declare their tools and the agent
// discovers them on demand. Hardcoding a tool id in a prompt is a regression of
// that principle and is caught here.
const TOOL_RE = new RegExp(`\\b(${TOOL_IDS.join('|')})\\b`)

function stripFrontmatter(text: string): string {
  const m = text.match(/^---\r?\n[\s\S]*?\r?\n---\r?\n/)
  return m ? text.slice(m[0].length) : text
}

describe('system prompts contain no hardcoded tool ids', () => {
  it('resolved brain instructions name no tool', () => {
    const prompt = getBrainInstructions({} as any)
    expect(prompt).not.toMatch(TOOL_RE)
  })

  it('core contract names no tool', () => {
    expect(CORE_CONTRACT).not.toMatch(TOOL_RE)
  })

  it('council persona narrative bodies name no tool', () => {
    const dir = join(process.cwd(), 'src/council/personas')
    for (const f of readdirSync(dir)) {
      if (!f.endsWith('.md')) continue
      const body = stripFrontmatter(readFileSync(join(dir, f), 'utf-8'))
      expect(body, `persona ${f} should not hardcode tool ids`).not.toMatch(TOOL_RE)
    }
  })
})
