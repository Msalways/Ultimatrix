import { describe, it, expect } from 'vitest'
import { graphqlBola } from '../../src/primitives/graphqlBola'
import { runPrimitive } from '../../src/primitives/framework'
import { EvidenceGate } from '../../src/intelligence/evidence-gate'
import type { AttackStep, StepExecutionResult, TechniqueContext } from '../../src/primitives/framework'

function fakeExecutor(vulnerable: boolean): (step: AttackStep) => Promise<StepExecutionResult> {
  return async (step: AttackStep): Promise<StepExecutionResult> => {
    const kind = (step.metadata as any)?.kind as string
    const altObjectId = (step.metadata as any)?.altObjectId ?? 'victim-999'

    if (vulnerable) {
      switch (kind) {
        case 'introspect':
          // Introspection enabled in production.
          return {
            step,
            ok: true,
            status: 200,
            body: JSON.stringify({ data: { __schema: { queryType: { name: 'Query' }, types: [{ name: 'User', kind: 'OBJECT', fields: [{ name: 'email' }] }] } } }),
          }
        case 'global-id':
          // Actor session returns the victim's object by global id.
          return {
            step,
            ok: true,
            status: 200,
            body: JSON.stringify({
              data: { node: { id: altObjectId, name: 'Victim User', email: 'victim@x.com' } },
            }),
          }
        case 'field-authz':
          // Field-level probe leaks the victim's sensitive fields.
          return {
            step,
            ok: true,
            status: 200,
            body: JSON.stringify({
              data: { me: { id: 'me', email: 'me@x.com' }, user: { id: altObjectId, email: 'victim@x.com', role: 'admin' } },
            }),
          }
      }
    }

    // Safe: introspection disabled + cross-user query denied / no victim data.
    switch (kind) {
      case 'introspect':
        return { step, ok: true, status: 400, body: JSON.stringify({ errors: [{ message: 'GraphQL introspection is not allowed' }] }) }
      case 'global-id':
        return { step, ok: true, status: 403, body: JSON.stringify({ errors: [{ message: 'Forbidden: not your object' }] }) }
      case 'field-authz':
        return { step, ok: true, status: 403, body: JSON.stringify({ errors: [{ message: 'Forbidden' }] }) }
    }
    return { step, ok: true, status: 403, body: 'forbidden' }
  }
}

const ctx: TechniqueContext = {
  endpoint: { url: 'https://api.example.com/graphql', method: 'POST' },
  target: 'https://api.example.com/graphql',
  altObjectId: 'victim-999',
  sessionHeaders: { Authorization: 'Bearer ACTOR' },
}

describe('graphqlBola', () => {
  it('appliesTo accepts a GraphQL endpoint', () => {
    expect(graphqlBola.appliesTo(ctx)).toBe(true)
    expect(graphqlBola.appliesTo({} as TechniqueContext)).toBe(false)
  })

  it('confirms GraphQL BOLA (high) when introspection + global-id leak victim data', async () => {
    const gate = new EvidenceGate()
    const res = await runPrimitive(graphqlBola, ctx, fakeExecutor(true), gate)
    expect(res.confirmed).toBe(true)
    expect(res.severity).toBe('high')
    expect(res.finding?.category).toBe('graphql_bola')
    expect(res.note).toContain('globalLeak=true')
    expect(res.note).toContain('verified=true')
  })

  it('does not confirm when cross-user access is properly denied', async () => {
    const gate = new EvidenceGate()
    const res = await runPrimitive(graphqlBola, ctx, fakeExecutor(false), gate)
    expect(res.confirmed).toBe(false)
    expect(res.finding).toBeUndefined()
    expect(res.note).toContain('globalLeak=false')
  })

  it('flags field-level leak as cross-user high severity', async () => {
    const gate = new EvidenceGate()
    // Introspection disabled but field-level probe still leaks victim data.
    const exec: (s: AttackStep) => Promise<StepExecutionResult> = async (s) => {
      const kind = (s.metadata as any)?.kind as string
      const altObjectId = (s.metadata as any)?.altObjectId ?? 'victim-999'
      if (kind === 'introspect') {
        return { step: s, ok: true, status: 400, body: JSON.stringify({ errors: [{ message: 'introspection disabled' }] }) }
      }
      if (kind === 'global-id') {
        return { step: s, ok: true, status: 403, body: JSON.stringify({ errors: [{ message: 'Forbidden' }] }) }
      }
      if (kind === 'field-authz') {
        return {
          step: s,
          ok: true,
          status: 200,
          body: JSON.stringify({ data: { me: { id: 'me' }, user: { id: altObjectId, email: 'victim@x.com', role: 'admin' } } }),
        }
      }
      return { step: s, ok: true, status: 403, body: 'forbidden' }
    }
    const res = await runPrimitive(graphqlBola, ctx, exec, gate)
    expect(res.confirmed).toBe(true)
    expect(res.severity).toBe('high')
    expect(res.note).toContain('fieldLeak=true')
    expect(res.finding?.cwe).toBe('CWE-639')
  })

  it('reports medium when only introspection is exposed (no cross-user leak)', async () => {
    const gate = new EvidenceGate()
    const exec: (s: AttackStep) => Promise<StepExecutionResult> = async (s) => {
      const kind = (s.metadata as any)?.kind as string
      if (kind === 'introspect') {
        return { step: s, ok: true, status: 200, body: JSON.stringify({ data: { __schema: { queryType: { name: 'Query' } } } }) }
      }
      // Cross-user queries properly denied.
      return { step: s, ok: true, status: 403, body: JSON.stringify({ errors: [{ message: 'Forbidden' }] }) }
    }
    const res = await runPrimitive(graphqlBola, ctx, exec, gate)
    expect(res.confirmed).toBe(true)
    expect(res.severity).toBe('medium')
    expect(res.finding?.cwe).toBe('CWE-200')
  })
})
