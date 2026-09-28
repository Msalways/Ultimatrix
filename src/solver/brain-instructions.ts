import { readFileSync, existsSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { ASSUMPTION_VERIFICATION, EVIDENCE_DISCIPLINE } from '../prompts/core-contract'
import { bountyContractBlock } from '../prompts/bounty-contract'
import { isBountyProfile } from '../safety/bounty-policy'
import type { UltimatrixConfig } from '../config'

/**
 * Solver-brain system prompt.
 *
 * Loaded from instructions/brain.md at runtime. Dynamic placeholders
 * (persona name, tone) are replaced by the TS loader. Evidence discipline
 * and assumption verification are appended from the shared core-contract.md
 * (single source, no copy-drift).
 *
 * Hard rule: no concrete tool ids in this text (capability is discovered live;
 * enforced by test).
 */

function findBrainPath(): string {
  const srcPath = resolve(import.meta.dirname ?? __dirname, '..', '..', 'instructions', 'brain.md')
  if (existsSync(srcPath)) return srcPath
  let dir = process.cwd()
  for (let i = 0; i < 10; i++) {
    const candidate = resolve(dir, 'instructions', 'brain.md')
    if (existsSync(candidate)) return candidate
    const parent = dirname(dir)
    if (parent === dir) break
    dir = parent
  }
  return srcPath
}

const brainMd = readFileSync(findBrainPath(), 'utf-8')

export function getBrainInstructions(config?: UltimatrixConfig): string {
  const personaName = config?.assistant?.name?.trim() || 'Jarvis'
  const tone = config?.assistant?.tone ?? 'concise-wit'
  const toneLine =
    tone === 'plain'
      ? 'Keep the tone plain and direct at all times.'
      : 'Framing may carry dry wit; findings, severities, and claims never do.'

  const body = brainMd
    .replace('{{PERSONA_NAME}}', personaName)
    .replace('{{TONE_LINE}}', toneLine)

  // Append shared evidence discipline and assumption verification
  const shared = `${body}\n\n${EVIDENCE_DISCIPLINE}\n\n${ASSUMPTION_VERIFICATION}`

  // Live bounty engagements additionally get program-triage and impact
  // discipline. Read the profile from the engagement container, not from the
  // passed config alone: the effective config may be a different object than the
  // one the CLI mutated, and a gate that reads the wrong surface silently
  // stands down mid-run.
  const bounty = isBountyProfile() || config?.bounty?.enabled === true ? bountyContractBlock() : ''
  return bounty ? `${shared}\n\n${bounty}` : shared
}

export const BRAIN_INSTRUCTIONS = getBrainInstructions({} as UltimatrixConfig)
