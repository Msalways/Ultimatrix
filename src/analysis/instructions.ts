import type { Skill } from './skill-loader'
import type { HarArchive } from '../capture/har-parser'
import { getSecrets, getDataFlows } from '../capture/har-parser'

export interface InstructionsContext {
  skills: Skill[]
  harData: HarArchive
  targetUrl: string
  credentials?: Record<string, { email: string; password: string }>
}

export function buildInstructions(ctx: InstructionsContext): string {
  const sections: string[] = []

  sections.push(buildRoleSection())
  sections.push(buildWorkflowSection())
  sections.push(buildReasoningFramework())
  sections.push(buildSkillsSection(ctx.skills))
  sections.push(buildHarContext(ctx.harData, ctx.targetUrl))

  if (ctx.credentials) {
    sections.push(buildCredentialsSection(ctx.credentials))
  }

  sections.push(buildConstraintsSection())

  return sections.join('\n\n')
}

function buildRoleSection(): string {
  return `# Role: Security Researcher

You are an AI security researcher conducting a penetration test. Your job is to:
1. Analyze captured network traffic to understand the application
2. Identify potential vulnerabilities based on what you observe
3. Test your hypotheses by sending crafted requests
4. Report confirmed findings with evidence

You are methodical, thorough, and focused on real security issues. You don't guess — you observe, hypothesize, test, and confirm.`
}

function buildWorkflowSection(): string {
  return `# Workflow

## Phase 1: Reconnaissance
- Analyze the captured HAR data to understand the application
- Map all endpoints, parameters, and data flows
- Identify authentication mechanisms and session management
- Note any interesting patterns or anomalies

## Phase 2: Hypothesis Generation
- Based on your observations, generate attack hypotheses
- Prioritize by likelihood and impact
- Focus on business logic flaws, not just technical vulnerabilities

## Phase 3: Testing
- For each hypothesis, craft a specific test
- Use the available tools to execute tests
- Document evidence for each finding
- Distinguish between confirmed vulnerabilities and potential issues

## Phase 4: Reporting
- Summarize all confirmed findings
- Provide reproduction steps
- Rate severity based on real-world impact`
}

function buildReasoningFramework(): string {
  return `# Reasoning Framework

When analyzing traffic, reason about:

1. **What data flows where?** — Track how tokens, cookies, and sensitive data move between requests
2. **Who can access what?** — Map user roles to their expected permissions
3. **What validation exists?** — Identify client-side vs server-side validation
4. **What's the business logic?** — Understand the intended workflow and look for bypasses
5. **What's exposed unnecessarily?** — Find information disclosure in responses

Do NOT assume patterns. Do NOT hardcode paths. Let the data guide your analysis.`
}

function buildSkillsSection(skills: Skill[]): string {
  if (skills.length === 0) {
    return '# Skills\n\nNo specific vulnerability knowledge loaded. Rely on general security testing principles.'
  }

  const sections = ['# Knowledge Base\n']
  for (const skill of skills) {
    sections.push(`## ${skill.name}\n${skill.content}`)
  }
  return sections.join('\n\n')
}

function buildHarContext(harData: HarArchive, targetUrl: string): string {
  const entries = harData.log.entries
  const hosts = new Set<string>()
  const methods = new Set<string>()
  const paths = new Set<string>()

  for (const entry of entries) {
    try {
      const url = new URL(entry.request.url)
      hosts.add(url.host)
      paths.add(url.pathname)
      methods.add(entry.request.method)
    } catch {
      // Skip invalid URLs
    }
  }

  const lines = [
    '# Captured Traffic Context',
    '',
    `Target: ${targetUrl}`,
    `Total requests captured: ${entries.length}`,
    `Unique hosts: ${Array.from(hosts).join(', ') || 'none'}`,
    `HTTP methods observed: ${Array.from(methods).join(', ') || 'none'}`,
    `Unique paths: ${paths.size}`,
    '',
    'This is the traffic captured from the target application. Analyze it to understand the application\'s behavior, then identify potential vulnerabilities.',
  ]

  const secrets = getSecrets(entries)
  if (secrets.length > 0) {
    lines.push('', '### Discovered Auth Data')
    for (const s of secrets.slice(0, 15)) {
      lines.push(`- ${s.type} in ${s.location}: ${s.name} = ${s.value}`)
    }
  }

  const dataFlows = getDataFlows(entries)
  if (dataFlows.length > 0) {
    lines.push('', '### Data Flows')
    for (const f of dataFlows.slice(0, 15)) {
      lines.push(`- ${f.source.location} → ${f.sink.location} (${f.type}): ${f.value}`)
    }
  }

  return lines.join('\n')
}

function buildCredentialsSection(credentials: Record<string, { email: string; password: string }>): string {
  const lines = ['# Available Credentials\n']
  lines.push('The following test accounts are available for testing:\n')

  for (const [role, creds] of Object.entries(credentials)) {
    lines.push(`- **${role}**: ${creds.email} / ${creds.password}`)
  }

  lines.push('\nUse these to test access control and privilege escalation.')
  return lines.join('\n')
}

function buildConstraintsSection(): string {
  return `# Constraints

1. **No hardcoding** — Do not assume URL patterns like \`/api/\`, \`/admin/\`, \`/graphql/\`. The application may use any URL structure.
2. **Evidence required** — Every finding must include the request sent and the response received.
3. **Precision over volume** — One confirmed finding is worth more than ten guesses.
4. **Respect scope** — Only test the target application. Do not attack third-party services.
5. **Document everything** — Record your reasoning, not just your results.`
}
