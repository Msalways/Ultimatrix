import type { ToolAdapter } from './types'
import { nucleiAdapter } from './nuclei'
import { sqlmapAdapter } from './sqlmap'
import { ffufAdapter } from './ffuf'
import { nmapAdapter } from './nmap'
import { jwtToolAdapter } from './jwttool'
import { arjunAdapter } from './arjun'
import { corsyAdapter } from './corsy'
import { subfinderAdapter } from './subfinder'
import { gitleaksAdapter } from './gitleaks'

export type { ToolAdapter } from './types'

/** All orchestrated external-tool adapters (in registration order). */
export const ALL_ADAPTERS: ToolAdapter[] = [
  nucleiAdapter,
  sqlmapAdapter,
  ffufAdapter,
  nmapAdapter,
  jwtToolAdapter,
  arjunAdapter,
  corsyAdapter,
  subfinderAdapter,
  gitleaksAdapter,
]

export function getAdapter(id: string): ToolAdapter | undefined {
  return ALL_ADAPTERS.find(a => a.id === id)
}
