import { readFileSync, existsSync } from 'node:fs'
import { resolve, dirname } from 'node:path'

/**
 * Bounty Engagement Contract — single source for live bounty-mode framing.
 *
 * Composed into the solver brain ONLY when the live bounty profile is active, so
 * the default lab prompt is byte-identical to before. Kept separate from
 * core-contract.md because program-triage and impact-discipline rules are wrong
 * for local/lab engagements and would distort them.
 *
 * Line endings are normalized before section extraction: extraction matches on
 * `\n` and the file checks out as CRLF on Windows. Without this the sections
 * silently extract as empty and the brain runs unguarded — the same failure mode
 * documented in core-contract.ts.
 */

function findContractPath(): string {
  const srcPath = resolve(import.meta.dirname ?? __dirname, '..', '..', 'instructions', 'bounty-contract.md')
  if (existsSync(srcPath)) return srcPath
  let dir = process.cwd()
  for (let i = 0; i < 10; i++) {
    const candidate = resolve(dir, 'instructions', 'bounty-contract.md')
    if (existsSync(candidate)) return candidate
    const parent = dirname(dir)
    if (parent === dir) break
    dir = parent
  }
  return srcPath
}

const contractMd = readFileSync(findContractPath(), 'utf-8').replace(/\r\n/g, '\n')

/** Extract a ### section body by heading text. */
function extractSection(md: string, heading: string): string {
  const regex = new RegExp(`### ${heading}\\n([\\s\\S]*?)(?=\\n### |\\n## |$)`, 'i')
  const match = md.match(regex)
  return match ? match[1].trim() : ''
}

export const BOUNTY_CONTRACT = contractMd

export const BOUNTY_PROGRAM_RULES = extractSection(contractMd, 'Program Rules First')
export const BOUNTY_TRIAGE = extractSection(contractMd, 'Triage')
export const BOUNTY_IMPACT_DISCIPLINE = extractSection(contractMd, 'Impact Discipline')
export const BOUNTY_REPORTABILITY = extractSection(contractMd, 'Reportability and Noise')
export const BOUNTY_CONTINUATION = extractSection(contractMd, 'Continuation')

/**
 * The composed bounty block appended to the brain prompt, or an empty string
 * when the contract fails to load. Returning empty (rather than throwing) keeps
 * a packaging problem from bricking a run — but callers that enable bounty mode
 * assert on the exported sections, and a test locks that they are non-empty.
 */
export function bountyContractBlock(): string {
  const sections = [
    BOUNTY_PROGRAM_RULES,
    BOUNTY_TRIAGE,
    BOUNTY_IMPACT_DISCIPLINE,
    BOUNTY_REPORTABILITY,
    BOUNTY_CONTINUATION,
  ].filter((section) => section.length > 0)

  if (sections.length === 0) return ''
  return `## Live bounty engagement\n\n${sections.join('\n\n')}`
}
