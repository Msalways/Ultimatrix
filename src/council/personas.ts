/**
 * Council persona instructions (the "personality" / voice + mandate per role).
 *
 * Design principle: each persona instructs the LLM to output STRUCTURED JSON
 * with typed fields. The orchestrator reads typed fields, never parses text.
 *
 * Root-cause rewrite: persona strings are now loaded from .md files with
 * YAML frontmatter metadata. The file loader replaces hardcoded strings.
 * Rich personas with backstories, expertise, and debate behavior replace
 * the previous 3-6 line descriptions.
 */

import type { CouncilMemberRole } from './types'
import { loadPersonaFile, loadCharter, loadDebateProtocol, loadOutputContract, type PersonaMetadata } from './persona-loader'

// ─── Assembled persona prompt ──────────────────────────────────────────────

/** Charter + role prompt + debate protocol + output contract. */
function assemblePersona(role: CouncilMemberRole): string {
  const charter = loadCharter()
  const rolePersona = loadPersonaFile(role)
  const protocol = loadDebateProtocol()
  const contract = loadOutputContract()

  const parts = [
    charter.prompt,
    '',
    '---',
    '',
    rolePersona.prompt,
    '',
    '---',
    '',
    protocol.prompt,
    '',
    '---',
    '',
    contract.prompt,
  ]

  return parts.join('\n')
}

// ─── Public API ─────────────────────────────────────────────────────────────

export function personaFor(role: CouncilMemberRole, override?: string): string {
  if (override) return override
  // Human doesn't need the full persona — approval is via gate, not structured output
  if (role === 'human') {
    return loadPersonaFile('human')?.prompt ?? `You are the human operator, a seated member of the council.`
  }
  return assemblePersona(role)
}

export function personaMetadataFor(role: CouncilMemberRole): PersonaMetadata {
  return loadPersonaFile(role).metadata
}

export function defaultCouncilConfig(overrides: Partial<{
  members: CouncilMemberRole[]
  approvalMode: 'autonomous' | 'hitl' | 'both'
  maxRounds: number
}> = {}): import('./types').CouncilConfig {
  return {
    enabled: true,
    members: overrides.members ?? ['strategist', 'operator', 'skeptic', 'analyst', 'human'],
    approvalMode: overrides.approvalMode ?? 'both',
    maxRounds: overrides.maxRounds ?? 8,
    budgetPerRound: 20000,
  }
}
