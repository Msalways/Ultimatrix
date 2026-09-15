/**
 * Multi-Role Orchestration — tool-filtered personas within single LLM brain.
 *
 * Adapted from PWN's 12-delegate architecture. Instead of multi-process delegation,
 * we use tool-filtered personas: same LLM, different tool sets per role.
 *
 * Roles: recon, injection, auth, reporting, analysis
 * Each role restricts which tools are available to reduce prompt size + noise.
 *
 * Purpose: Simulate specialized agents without the overhead of actual delegation.
 */

export type AgentRole = 'recon' | 'injection' | 'auth' | 'reporting' | 'analysis'

export interface RoleConfig {
  description: string
  toolRefs: string[]
  focus: string[]
  constraints: string[]
}

export const ROLE_CONFIGS: Record<AgentRole, RoleConfig> = {
  recon: {
    description: 'Reconnaissance and discovery. Focus on mapping attack surface.',
    toolRefs: ['httpRequest', 'queryGraph', 'getGraphSchema', 'getCaptureOverview', 'dnsLookup', 'whoisLookup', 'subdomainBrute', 'listSkills', 'loadSkill'],
    focus: ['Endpoint discovery', 'Authentication detection', 'API surface mapping', 'Technology stack identification'],
    constraints: ['No exploitation', 'No mutation requests', 'Read-only reconnaissance'],
  },
  injection: {
    description: 'Injection testing across all input surfaces.',
    toolRefs: ['httpRequest', 'queryGraph', 'runPrimitive', 'writeFinding', 'recordTest', 'encode-decode'],
    focus: ['SQL injection', 'NoSQL injection', 'XSS', 'SSTI', 'Command injection', 'SSRF'],
    constraints: ['Exploit-proof required before writeFinding', 'Evidence-gated claims only', 'Respect scope guard'],
  },
  auth: {
    description: 'Authentication and authorization testing.',
    toolRefs: ['httpRequest', 'queryGraph', 'runPrimitive', 'writeFinding', 'extractBrowserAuth', 'detectAuthFlows', 'testSessionValid', 'verifyChains'],
    focus: ['Auth bypass', 'IDOR/BOLA', 'Privilege escalation', 'Session management', 'JWT weaknesses'],
    constraints: ['Test with multiple roles', 'Document auth flow changes', 'Never persist credentials'],
  },
  reporting: {
    description: 'Report compilation and finding summarization.',
    toolRefs: ['queryGraph', 'getCaptureOverview', 'writeFinding', 'listSkills', 'saveSession'],
    focus: ['Finding severity classification', 'Exploit proof compilation', 'Remediation recommendations'],
    constraints: ['Only read/summarize existing findings', 'No new exploitation', 'Structured output only'],
  },
  analysis: {
    description: 'Business logic analysis and value-provenance tracking.',
    toolRefs: ['httpRequest', 'queryGraph', 'getGraphSchema', 'queryRelations', 'runPrimitive', 'writeFinding'],
    focus: ['Value flow tracking', 'Business logic flaws', 'Race conditions', 'State machine bugs'],
    constraints: ['Trace data flow through all endpoints', 'Verify invariants', 'Document assumptions'],
  },
}

export function getToolsForRole(role: AgentRole): string[] {
  return ROLE_CONFIGS[role].toolRefs
}

export function getRoleDescription(role: AgentRole): RoleConfig {
  return ROLE_CONFIGS[role]
}

export function filterToolsForRole(allTools: string[], role: AgentRole): string[] {
  const allowed = new Set(getToolsForRole(role))
  return allTools.filter(t => allowed.has(t))
}

/** Build a persona prompt prefix for a given role. */
export function buildRolePrompt(role: AgentRole): string {
  const config = ROLE_CONFIGS[role]
  const lines: string[] = [
    `## Role: ${role.toUpperCase()}`,
    config.description,
    '',
    `### Focus Areas`,
    ...config.focus.map(f => `- ${f}`),
    '',
    `### Constraints`,
    ...config.constraints.map(c => `- ${c}`),
  ]
  return lines.join('\n')
}
