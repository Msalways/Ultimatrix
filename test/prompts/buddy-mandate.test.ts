/**
 * Buddy-not-butler guards.
 *
 * Locks the properties that make the assistant a peer rather than an executor.
 * Each of these can be silently destroyed by an innocuous prompt edit, so they
 * are asserted rather than trusted.
 */
import { describe, it, expect } from 'vitest'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { getBrainInstructions } from '../../src/solver/brain-instructions'
import { TOOL_IDS } from '../../src/mastra/tools'

const ALLOWED_TOOL_MENTIONS = new Set(['listTools', 'loadTool'])
const TOOL_RE = new RegExp(`\\b(${TOOL_IDS.filter(id => !ALLOWED_TOOL_MENTIONS.has(id)).join('|')})\\b`)

describe('buddy mandate', () => {
  const prompt = getBrainInstructions({} as any)

  it('no longer compels an action every single turn', () => {
    // The old mandate ("Every turn must do at least one of: observe, react, or
    // attack") structurally forbade pushback, which is what made the assistant a
    // slave no matter how the tone was written.
    expect(prompt).not.toMatch(/Every turn must do at least one of/)
  })

  it('declining a request is explicitly a first-class outcome', () => {
    expect(prompt).toMatch(/request you declined, with your reason/i)
    expect(prompt).toMatch(/Declining is correct/i)
  })

  it('states the effectiveness read must come before executing', () => {
    expect(prompt).toMatch(/Before executing, state your read/i)
    expect(prompt).toMatch(/cost against value/i)
  })

  it('requires both sides to disclose when they overrule the other', () => {
    expect(prompt).toMatch(/Overruling is fine either way; say why/i)
    expect(prompt).toMatch(/Overruling is fine either way; say why/i)
  })

  it('requires rulings to be recorded, not left in conversation', () => {
    expect(prompt).toMatch(/Record rulings with the disposition tool/i)
    expect(prompt).toMatch(/Never let a correction live only in chat/i)
  })

  it('distinguishes expected behaviour from a rejection', () => {
    expect(prompt).toMatch(/Use `expected` when behaviour is normal/i)
  })

  it('allows disagreement to stand unresolved', () => {
    expect(prompt).toMatch(/Disagreements may stand/i)
    expect(prompt).toMatch(/Disagreements may stand/i)
  })

  it('keeps the buddy working while blocked, rather than idling', () => {
    expect(prompt).toMatch(/Don't idle on non-blocking answers/i)
  })

  it('still forbids blind compliance in the other direction too', () => {
    expect(prompt).toMatch(/Declining is correct/i)
  })

  it('names no concrete tool ids', async () => {
    const md = await readFile(join(process.cwd(), 'instructions/brain.md'), 'utf8')
    expect(md).not.toMatch(TOOL_RE)
  })

  it('forbids agreeing in place of recording', () => {
    // Live failure: told casually that "those reflected-parameter things are
    // just how it is built, stop bringing them up", the model replied "you're
    // absolutely right, I apologize" and recorded NOTHING. Worse, it described
    // an unruled finding as "falling under your general ruling" — a ruling it
    // invented to be agreeable. Agreeing is the failure mode, not compliance.
    expect(prompt).toMatch(/Agreeing is not recording/i)
    expect(prompt).toMatch(/Record what they ruled, including when it extends to unruled claims/i)
  })

  it('forbids describing a ruling that is not in the record', () => {
    expect(prompt).toMatch(/never describe a ruling as existing unless the record has it/i)
    expect(prompt).toMatch(/say when you have none/i)
  })

  it('requires pushback when the operator contradicts the evidence', () => {
    expect(prompt).toMatch(/If their premise contradicts your evidence, say so/i)
  })

  it('did not turn the mandate into a rigid checklist', () => {
    // The list of possible turn endings is explicitly a judgement, not a
    // sequence — a numbered flow would recreate the master/slave problem.
    expect(prompt).toMatch(/A turn may end with/i)
    const section = prompt.slice(prompt.indexOf('## Judgement, not obedience'))
    expect(section).not.toMatch(/^\s*1\.\s/m)
  })
})




