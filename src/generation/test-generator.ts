export interface Finding {
  id: string
  title: string
  severity: 'critical' | 'high' | 'medium' | 'low' | 'info'
  category: string
  description: string
  evidence: Evidence[]
  request: {
    method: string
    url: string
    headers?: Record<string, string>
    body?: string
  }
  response?: {
    status: number
    body?: string
  }
  screenshots?: string[]
  remediation?: string
  cwe?: string
  impact?: string
  reproductionSteps?: string[]
  testFile?: string
  firstSeen: Date
  lastSeen: Date
  status: 'open' | 'fixed' | 'false-positive'
}

export interface Evidence {
  request: {
    method: string
    url: string
    headers?: Record<string, string>
    body?: string
  }
  response: {
    status: number
    headers?: Record<string, string>
    body: string
  }
  description: string
  screenshot?: string
}

export interface TestCase {
  id: string
  name: string
  description: string
  severity: Finding['severity']
  category: string
  code: string
  findingId: string
}

export function generateFromFinding(finding: Finding): TestCase {
  const code = generateTestCode(finding)
  const safeId = finding.id.replace(/[<>:"/\\|?*]/g, '-').replace(/--+/g, '-')

  return {
    id: `test-${safeId}`,
    name: `${finding.category}: ${finding.title}`,
    description: finding.description,
    severity: finding.severity,
    category: finding.category,
    code,
    findingId: finding.id,
  }
}

function generateTestCode(finding: Finding): string {
  const lines: string[] = []

  lines.push(`import { test, expect } from '@playwright/test'`)
  lines.push('')
  lines.push(`test('${escapeQuotes(finding.title)}', async ({ page }) => {`)

  // Setup: navigate to the app
  const url = new URL(finding.request.url)
  const baseUrl = `${url.protocol}//${url.host}`

  lines.push(`  // Setup: navigate to application`)
  lines.push(`  await page.goto('${escapeQuotes(baseUrl)}')`)
  lines.push(`  await page.waitForLoadState('networkidle')`)
  lines.push('')

  // Add setup steps based on evidence
  if (finding.evidence.length > 0) {
    lines.push(`  // Reproduce the attack`)
    for (const evidence of finding.evidence) {
      lines.push(...generateEvidenceSteps(evidence))
    }
  } else {
    // Generate from the finding's request directly
    lines.push(...generateRequestSteps(finding.request))
  }

  lines.push('')
  lines.push(`  // Verify: should NOT be vulnerable`)
  lines.push(`  // TODO: Add assertion based on expected secure behavior`)

  lines.push(`})`)

  return lines.join('\n')
}

function generateEvidenceSteps(evidence: Evidence): string[] {
  const lines: string[] = []
  const indent = '  '

  const method = evidence.request.method.toLowerCase()

  // Login if needed (check for auth headers)
  const authHeader = evidence.request.headers?.['authorization']
  if (authHeader) {
    lines.push(`${indent} // Authenticate`)
    lines.push(`${indent} // Using provided credentials`)
    lines.push('')
  }

  // Make the request
  if (method === 'get' || method === 'delete') {
    lines.push(`${indent}const response = await page.request.${method}('${escapeQuotes(evidence.request.url)}')`)
  } else {
    const body = evidence.request.body ? `, { data: ${evidence.request.body} }` : ''
    lines.push(`${indent}const response = await page.request.${method}('${escapeQuotes(evidence.request.url)}'${body})`)
  }

  // Check response
  if (evidence.response) {
    lines.push(`${indent}expect(response.status()).toBe(${evidence.response.status})`)
  }

  return lines
}

function generateRequestSteps(request: Finding['request']): string[] {
  const lines: string[] = []
  const indent = '  '

  const method = request.method.toLowerCase()

  if (method === 'get' || method === 'delete') {
    lines.push(`${indent}const response = await page.request.${method}('${escapeQuotes(request.url)}')`)
  } else {
    const body = request.body ? `, { data: ${request.body} }` : ''
    lines.push(`${indent}const response = await page.request.${method}('${escapeQuotes(request.url)}'${body})`)
  }

  return lines
}

function escapeQuotes(s: string): string {
  return s.replace(/'/g, "\\'").replace(/`/g, '\\`')
}

export function generateSetupCode(_credentials: Record<string, { email: string; password: string }>): string {
  const lines: string[] = []

  lines.push(`  // Login with test credentials`)
  lines.push(`  const loginResponse = await page.request.post('/api/auth/login', {`)
  lines.push(`    data: {`)
  lines.push(`      email: process.env.TEST_USER_EMAIL || 'test@test.com',`)
  lines.push(`      password: process.env.TEST_USER_PASSWORD || 'test123'`)
  lines.push(`    }`)
  lines.push(`  })`)
  lines.push(`  expect(loginResponse.ok()).toBeTruthy()`)
  lines.push('')

  return lines.join('\n')
}

export function generateAssertionCode(finding: Finding): string {
  const lines: string[] = []

  switch (finding.category) {
    case 'authorization':
      lines.push(`  // Should deny access (403 or redirect to login)`)
      lines.push(`  expect([401, 403]).toContain(response.status())`)
      break
    case 'information-disclosure':
      lines.push(`  // Should not expose sensitive information`)
      lines.push(`  const body = await response.text()`)
      lines.push(`  expect(body).not.toContain('stack trace')`)
      lines.push(`  expect(body).not.toContain('internal server error')`)
      break
    case 'business-logic':
      lines.push(`  // Should maintain data integrity`)
      lines.push(`  expect(response.status()).toBeLessThan(500)`)
      break
    default:
      lines.push(`  // Should not be vulnerable`)
      lines.push(`  expect(response.status()).toBeLessThan(500)`)
  }

  return lines.join('\n')
}
