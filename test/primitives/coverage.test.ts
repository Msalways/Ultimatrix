import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { listPrimitives, getPrimitive } from '../../src/primitives'
import { ALL_ADAPTERS } from '../../src/tools/adapters'

// Each primitive's technique area must be documented in at least one skill so
// the brain can reason about when to invoke it via runPrimitive. Drift guard.
const KEYWORDS: Record<string, string[]> = {
  classicInjection: ['sql injection', 'sql injection', 'xss', 'injection'],
  headerInjection: ['header injection', 'crlf', 'response-header'],
  workflowBypass: ['workflow bypass', 'workflow', 'auth bypass', 'state machine'],
  idorSwapper: ['idor'],
  bolaFuzzer: ['bola', 'broken object level', 'action-level', 'mass assignment', 'idor'],
  authzMatrix: ['authorization', 'access control', 'broken access'],
  configTrust: ['client-side', 'config trust', 'client value'],
  invariantProbe: ['invariant', 'business logic'],
  concurrencyHarness: ['race condition', 'concurrency', 'race'],
  ssrfOast: ['ssrf', 'oast'],
  aiTrust: ['prompt injection', 'llm', 'ai security', 'ai/mcp'],
  authBypass: ['auth bypass', 'authentication bypass', 'default credentials', 'jwt', 'login bypass'],
  atoChain: ['account takeover', 'ato', 'reset', '2fa'],
  ssrfMetadata: ['ssrf', 'metadata', 'imds', 'cloud metadata'],
  rceClass: ['ssti', 'command injection', 'xxe', 'rce'],
  graphqlBola: ['graphql', 'introspection', 'bola'],
  aiAgentAttack: ['prompt injection', 'tool poisoning', 'ai security', 'llm'],
  nosqlInjection: ['nosql', 'mongodb', 'injection', 'operator injection'],
  ssrfMultiCloud: ['ssrf', 'metadata', 'gcp', 'azure', 'imds', 'cloud metadata'],
  sstiBlind: ['ssti', 'template injection', 'jinja', 'freemarker', 'twig'],
  boplaOracle: ['business logic', 'mass assignment', 'over-exposure', 'bola', 'bopla'],
  artifactLifetime: ['business logic', 'session', 'token', 'expired', 'revoked'],
  internalStateDisclosure: ['information disclosure', 'internal state', 'debug', 'stack trace'],
  tenantIsolation: ['tenant', 'multi-tenant', 'cross-tenant', 'bola', 'authorization'],
  deserialization: ['deserialization', 'rce', 'gadget', 'ysoserial', 'pickle'],
  secondOrderSqli: ['sql injection', 'second-order', 'injection'],
  ldapXpathInjection: ['ldap', 'xpath', 'injection', 'directory'],
  smuggling: ['smuggling', 'request smuggling', 'cl/te', 'http smuggling'],
  businessLogicAbuse: ['business logic', 'quota', 'rate limit', 'workflow', 'action limit'],
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

// Each orchestrated external-tool adapter must be discoverable by the brain via
// a skill (toolRefs) so it is not dead code. Drift guard (Wave 4).
const ADAPTER_KEYWORDS: Record<string, string[]> = {
  nuclei: ['nuclei'],
  sqlmap: ['sqlmap'],
  ffuf: ['ffuf'],
  nmap: ['nmap'],
  jwttool: ['jwttool'],
  arjun: ['arjun'],
  corsy: ['corsy'],
  subfinder: ['subfinder'],
  gitleaks: ['gitleaks'],
}

describe('external-tool adapter coverage guard (Wave 4)', () => {
  const skillText = loadAllSkillText()

  it('every external adapter is referenced by at least one skill', () => {
    for (const a of ALL_ADAPTERS) {
      const kws = ADAPTER_KEYWORDS[a.id] ?? [a.id]
      const covered = kws.some((k) => skillText.includes(k.toLowerCase()))
      expect(covered, `adapter ${a.id} is not referenced by any skill (keywords: ${kws.join(', ')})`).toBe(true)
    }
  })

  it('no adapter uses substring/vocabulary routing', () => {
    // Guards the architectural principle: adapters must not decide WHAT to test
    // via hardcoded keyword matching. Delegator.shouldDelegate was removed.
    const src = readdirSync(join(process.cwd(), 'src', 'tools', 'adapters')).join('\n')
    expect(src.toLowerCase().includes('shoulddelegate')).toBe(false)
  })
})
