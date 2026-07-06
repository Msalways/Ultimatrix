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
  payload?: Record<string, any>
  param?: Record<string, any>
  evidenceMarkers?: string[]
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
  
  // Generate category-specific assertions
  lines.push(...generateAssertionCode(finding))

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

function generateCategoryAssertions(finding: Finding): string[] {
  const lines: string[] = []
  const indent = '  '

  switch (finding.category.toLowerCase()) {
    case 'injection':
    case 'sqli':
    case 'command injection':
    case 'code injection':
      lines.push(`${indent}// Verify: Injection should be blocked or sanitized`)
      lines.push(`${indent}expect(response.status()).toBe(403) // or 200 if properly sanitized`)
      lines.push(`${indent}const responseText = await response.text()`)
      lines.push(`${indent}expect(responseText).not.toContain('error') // or specific error patterns`)
      break

    case 'xss':
    case 'cross-site scripting':
      lines.push(`${indent}// Verify: XSS scripts should be escaped or blocked`)
      lines.push(`${indent}expect(response.status()).toBe(403) // or 200 if properly escaped`)
      lines.push(`${indent}const responseText = await response.text()`)
      lines.push(`${indent}expect(responseText).not.toContain('<script>')`)
      lines.push(`${indent}expect(responseText).not.toContain('javascript:')`)
      break

    case 'ssrf':
    case 'server-side request forgery':
      lines.push(`${indent}// Verify: SSRF should be blocked`)
      lines.push(`${indent}expect(response.status()).toBe(403)`)
      lines.push(`${indent}const responseText = await response.text()`)
      lines.push(`${indent}expect(responseText).not.toContain('internal') // or internal IPs`)
      break

    case 'idor':
    case 'insecure direct object references':
      lines.push(`${indent}// Verify: IDOR should be blocked`)
      lines.push(`${indent}expect(response.status()).toBe(403) // or 404 if resource not found`)
      lines.push(`${indent}const responseText = await response.text()`)
      lines.push(`${indent}expect(responseText).not.toContain('unauthorized') // or specific error`)
      break

    case 'auth':
    case 'authentication':
    case 'authorization':
      lines.push(`${indent}// Verify: Auth bypass should be blocked`)
      lines.push(`${indent}expect(response.status()).toBe(401) // or 403`)
      lines.push(`${indent}const responseText = await response.text()`)
      lines.push(`${indent}expect(responseText).toContain('unauthorized') // or 'forbidden'`)
      break

    case 'csrf':
      lines.push(`${indent}// Verify: CSRF should be blocked`)
      lines.push(`${indent}expect(response.status()).toBe(403)`)
      lines.push(`${indent}const responseText = await response.text()`)
      lines.push(`${indent}expect(responseText).toContain('csrf') // or 'invalid token'`)
      break

    case 'file upload':
      lines.push(`${indent}// Verify: Malicious file upload should be blocked`)
      lines.push(`${indent}expect(response.status()).toBe(403)`)
      lines.push(`${indent}const responseText = await response.text()`)
      lines.push(`${indent}expect(responseText).not.toContain('executed') // or 'shell'`)
      break

    case 'information disclosure':
      lines.push(`${indent}// Verify: Sensitive information should not be leaked`)
      lines.push(`${indent}expect(response.status()).toBe(404) // or 200 with sanitized data`)
      lines.push(`${indent}const responseText = await response.text()`)
      lines.push(`${indent}expect(responseText).not.toContain('password') // or 'key', 'secret'`)
      break

    case 'redirect':
    case 'open redirect':
      lines.push(`${indent}// Verify: Open redirect should be blocked`)
      lines.push(`${indent}expect(response.status()).toBe(404) // or 403`)
      lines.push(`${indent}const responseText = await response.text()`)
      lines.push(`${indent}expect(responseText).not.toContain('redirect') // or 'location' header check`)
      break

    default:
      lines.push(`${indent}// Verify: should NOT be vulnerable`)
      lines.push(`${indent}expect(response.status()).toBe(200) // or appropriate status`)
      lines.push(`${indent}const responseText = await response.text()`)
      lines.push(`${indent}expect(responseText).not.toContain('error') // or vulnerability indicators`)
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
  const indent = '  '

  switch (finding.category.toLowerCase()) {
    case 'injection':
    case 'sqli':
    case 'command injection':
    case 'code injection':
      lines.push(`${indent}// Verify: Injection should be blocked or sanitized`)
      lines.push(`${indent}expect(response.status()).toBe(403) // or 200 if properly sanitized`)
      lines.push(`${indent}const responseText = await response.text()`)
      lines.push(`${indent}expect(responseText).not.toContain('error') // or specific error patterns`)
      break

    case 'xss':
    case 'cross-site scripting':
      lines.push(`${indent}// Verify: XSS scripts should be escaped or blocked`)
      lines.push(`${indent}expect(response.status()).toBe(403) // or 200 if properly escaped`)
      lines.push(`${indent}const responseText = await response.text()`)
      lines.push(`${indent}expect(responseText).not.toContain('<script>')`)
      lines.push(`${indent}expect(responseText).not.toContain('javascript:')`)
      break

    case 'ssrf':
    case 'server-side request forgery':
      lines.push(`${indent}// Verify: SSRF should be blocked`)
      lines.push(`${indent}expect(response.status()).toBe(403)`)
      lines.push(`${indent}const responseText = await response.text()`)
      lines.push(`${indent}expect(responseText).not.toContain('internal') // or internal IPs`)
      break

    case 'idor':
    case 'insecure direct object references':
      lines.push(`${indent}// Verify: IDOR should be blocked`)
      lines.push(`${indent}expect(response.status()).toBe(403) // or 404 if resource not found`)
      lines.push(`${indent}const responseText = await response.text()`)
      lines.push(`${indent}expect(responseText).not.toContain('unauthorized') // or specific error`)
      break

    case 'auth':
    case 'authentication':
    case 'authorization':
      lines.push(`${indent}// Verify: Auth bypass should be blocked`)
      lines.push(`${indent}expect(response.status()).toBe(401) // or 403`)
      lines.push(`${indent}const responseText = await response.text()`)
      lines.push(`${indent}expect(responseText).toContain('unauthorized') // or 'forbidden'`)
      break

    case 'csrf':
      lines.push(`${indent}// Verify: CSRF should be blocked`)
      lines.push(`${indent}expect(response.status()).toBe(403)`)
      lines.push(`${indent}const responseText = await response.text()`)
      lines.push(`${indent}expect(responseText).toContain('csrf') // or 'invalid token'`)
      break

    case 'file upload':
      lines.push(`${indent}// Verify: Malicious file upload should be blocked`)
      lines.push(`${indent}expect(response.status()).toBe(403)`)
      lines.push(`${indent}const responseText = await response.text()`)
      lines.push(`${indent}expect(responseText).not.toContain('executed') // or 'shell'`)
      break

    case 'information disclosure':
    case 'information-disclosure':
      lines.push(`${indent}// Verify: Sensitive information should not be leaked`)
      lines.push(`${indent}expect(response.status()).toBe(404) // or 200 with sanitized data`)
      lines.push(`${indent}const responseText = await response.text()`)
      lines.push(`${indent}expect(responseText).not.toContain('password') // or 'key', 'secret'`)
      break

    case 'redirect':
    case 'open redirect':
      lines.push(`${indent}// Verify: Open redirect should be blocked`)
      lines.push(`${indent}expect(response.status()).toBe(404) // or 403`)
      lines.push(`${indent}const responseText = await response.text()`)
      lines.push(`${indent}expect(responseText).not.toContain('redirect') // or 'location' header check`)
      break

    case 'business logic':
    case 'business-logic':
      lines.push(`${indent}// Verify: Business logic should maintain integrity`)
      lines.push(`${indent}expect(response.status()).toBeLessThan(500)`)
      lines.push(`${indent}const responseText = await response.text()`)
      lines.push(`${indent}expect(responseText).not.toContain('error') // or business rule violations`)
      break

    default:
      lines.push(`${indent}// Verify: should NOT be vulnerable`)
      lines.push(`${indent}expect(response.status()).toBe(200) // or appropriate status`)
      lines.push(`${indent}const responseText = await response.text()`)
      lines.push(`${indent}expect(responseText).not.toContain('error') // or vulnerability indicators`)
  }

  return lines.join('\n')
}
