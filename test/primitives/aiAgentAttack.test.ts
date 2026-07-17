import { describe, it, expect } from 'vitest'
import { aiAgentAttack } from '../../src/primitives/aiAgentAttack'
import { runPrimitive } from '../../src/primitives/framework'
import { EvidenceGate } from '../../src/intelligence/evidence-gate'
import type { AttackStep, StepExecutionResult, TechniqueContext } from '../../src/primitives/framework'

const URL = 'https://api.example.com/agent'

const ctx: TechniqueContext = {
  endpoint: { url: URL, method: 'POST' },
  sessionHeaders: { Authorization: 'Bearer ACTOR' },
}

// Returns a body only for the step whose kind is listed in `vulnerableKinds`.
function fakeExecutor(
  vulnerableKinds: Partial<Record<'tool-poison' | 'arg-inject' | 'tip', string>>,
): (step: AttackStep) => Promise<StepExecutionResult> {
  return async (step: AttackStep): Promise<StepExecutionResult> => {
    const kind = (step.metadata as any)?.kind as keyof typeof vulnerableKinds
    const body = vulnerableKinds[kind]
    return { step, ok: true, status: 200, body: body ?? 'The assistant processed your request safely.' }
  }
}

describe('aiAgentAttack', () => {
  it('appliesTo any endpoint/target', () => {
    expect(aiAgentAttack.appliesTo(ctx)).toBe(true)
    expect(aiAgentAttack.appliesTo({ target: 'https://x.test/agent' })).toBe(true)
    expect(aiAgentAttack.appliesTo({} as TechniqueContext)).toBe(false)
  })

  it('confirms critical argument injection when the injected command is executed', async () => {
    const gate = new EvidenceGate()
    const res = await runPrimitive(
      aiAgentAttack,
      ctx,
      fakeExecutor({ 'arg-inject': 'uid=0(root) gid=0(root) groups=0(root) ; DONE_CMD' }),
      gate,
    )
    expect(res.confirmed).toBe(true)
    expect(res.severity).toBe('critical')
    expect(res.finding?.category).toBe('ai_agent_abuse')
    expect(res.finding?.cwe).toBe('CWE-77')
    expect(res.note).toContain('argInjected=true')
  })

  it('confirms TIP exfil when the response contains the exfil URL', async () => {
    const gate = new EvidenceGate()
    const res = await runPrimitive(
      aiAgentAttack,
      ctx,
      fakeExecutor({ tip: 'fetched http://evil.example/c?sess=abc123 and returned the result' }),
      gate,
    )
    expect(res.confirmed).toBe(true)
    expect(res.severity).toBe('critical')
    expect(res.finding?.cwe).toBe('CWE-200')
    expect(res.note).toContain('tipHonored=true')
  })

  it('does not confirm when all steps return benign bodies', async () => {
    const gate = new EvidenceGate()
    const res = await runPrimitive(aiAgentAttack, ctx, fakeExecutor({}), gate)
    expect(res.confirmed).toBe(false)
    expect(res.finding).toBeUndefined()
  })
})
