import { readFileSync, existsSync } from 'node:fs'
import { resolve, dirname } from 'node:path'

/**
 * Core Contract — Single source of truth for authorization framing,
 * anti-hallucination rules, workflow guidance, and output format.
 *
 * Loaded from instructions/core-contract.md at runtime.
 * The Evidence & Integrity and Assumption Verification sections are extracted
 * separately so the solver brain composes the SAME discipline (single source,
 * no copy-drift) without inheriting worker-specific workflow/output rules.
 */

function findContractPath(): string {
  // Try source layout first (dev mode)
  const srcPath = resolve(import.meta.dirname ?? __dirname, '..', '..', 'instructions', 'core-contract.md')
  if (existsSync(srcPath)) return srcPath
  // Fallback: walk up from cwd to find package root with instructions/
  let dir = process.cwd()
  for (let i = 0; i < 10; i++) {
    const candidate = resolve(dir, 'instructions', 'core-contract.md')
    if (existsSync(candidate)) return candidate
    const parent = dirname(dir)
    if (parent === dir) break
    dir = parent
  }
  return srcPath // best guess
}

const contractMd = readFileSync(findContractPath(), 'utf-8')

/**
 * Extract a ### section from the markdown by heading text.
 * Returns the section body (lines after the heading, before the next heading).
 */
function extractSection(md: string, heading: string): string {
  const regex = new RegExp(`### ${heading}\\n([\\s\\S]*?)(?=\\n### |\\n## |$)`, 'i')
  const match = md.match(regex)
  return match ? match[1].trim() : ''
}

// Export the full contract as-is
export const CORE_CONTRACT = contractMd

// Export extracted sections for brain composition (single source, no drift)
export const EVIDENCE_DISCIPLINE = extractSection(contractMd, 'Evidence & Integrity')

export const ASSUMPTION_VERIFICATION = extractSection(contractMd, 'Assumption Verification')
