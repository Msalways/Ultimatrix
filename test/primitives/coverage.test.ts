import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { listPrimitives, getPrimitive } from '../../src/primitives'

// Each primitive's technique area must be documented in at least one skill so
// the brain can reason about when to invoke it via runPrimitive. Drift guard.
const KEYWORDS: Record<string, string[]> = {
  classicInjection: ['sql injection', 'sql injection', 'xss', 'injection'],
  headerInjection: ['header injection', 'crlf', 'response-header'],
  workflowBypass: ['workflow bypass', 'workflow', 'auth bypass', 'state machine'],
  idorSwapper: ['idor'],
  authzMatrix: ['authorization', 'access control', 'broken access'],
  configTrust: ['client-side', 'config trust', 'client value'],
  invariantProbe: ['invariant', 'business logic'],
  concurrencyHarness: ['race condition', 'concurrency', 'race'],
  ssrfOast: ['ssrf', 'oast'],
  aiTrust: ['prompt injection', 'llm', 'ai security', 'ai/mcp'],
  authBypass: ['auth bypass', 'authentication bypass', 'default credentials', 'jwt', 'login bypass'],
}

function loadAllSkillText(): string {
  const root = join(process.cwd(), 'skills')
  const out: string[] = []
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name)
      if (statSync(p).isDirectory()) walk(p)
      else if (p.endsWith('.md')) out.push(readFileSync(p, 'utf8'))
    }
  }
  walk(root)
  return out.join('\n').toLowerCase()
}

describe('primitive coverage guard (WS-C)', () => {
  const skillText = loadAllSkillText()

  it('every primitive is documented by at least one skill', () => {
    for (const p of listPrimitives()) {
      const kws = KEYWORDS[p.id] ?? []
      const covered = kws.some((k) => skillText.includes(k.toLowerCase()))
      expect(covered, `primitive ${p.id} has no skill coverage (keywords: ${kws.join(', ')})`).toBe(true)
    }
  })

  it('every primitive is well-formed (generator + oracle + description)', () => {
    for (const p of listPrimitives()) {
      const full = getPrimitive(p.id)!
      expect(typeof full.generate).toBe('function')
      expect(typeof full.oracle).toBe('function')
      expect(typeof full.appliesTo).toBe('function')
      expect(full.description && full.description.length > 0).toBe(true)
    }
  })
})
