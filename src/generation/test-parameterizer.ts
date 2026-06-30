import type { TestCase } from './test-generator'

export interface Variation {
  type: 'user' | 'payload' | 'method' | 'content-type'
  name: string
  value: Record<string, string>
}

export interface UserVariant {
  role: string
  credentials: { email: string; password: string }
  token?: string
}

export function parameterize(test: TestCase, variations: Variation[]): TestCase[] {
  const results: TestCase[] = []

  for (const variation of variations) {
    const parametrized = { ...test }
    parametrized.id = `${test.id}-${variation.name}`
    parametrized.name = `${test.name} [${variation.name}]`

    // Replace placeholders in test code
    let code = test.code
    for (const [key, value] of Object.entries(variation.value)) {
      code = code.replace(new RegExp(`\\{\\{${key}\\}\\}`, 'g'), value)
    }
    parametrized.code = code

    results.push(parametrized)
  }

  return results
}

export function generateUserVariants(users: UserVariant[]): Variation[] {
  return users.map(user => ({
    type: 'user' as const,
    name: user.role,
    value: {
      'USER_EMAIL': user.credentials.email,
      'USER_PASSWORD': user.credentials.password,
      'USER_TOKEN': user.token || '',
      'USER_ROLE': user.role,
    },
  }))
}

export function generatePayloadVariants(category: string): Variation[] {
  const payloadSets: Record<string, Variation[]> = {
    'xss': [
      { type: 'payload', name: 'script-tag', value: { 'PAYLOAD': '<script>alert(1)</script>' } },
      { type: 'payload', name: 'img-onerror', value: { 'PAYLOAD': '<img src=x onerror=alert(1)>' } },
      { type: 'payload', name: 'svg-onload', value: { 'PAYLOAD': '<svg onload=alert(1)>' } },
    ],
    'sqli': [
      { type: 'payload', name: 'single-quote', value: { 'PAYLOAD': "'" } },
      { type: 'payload', name: 'union-select', value: { 'PAYLOAD': "' UNION SELECT NULL--" } },
      { type: 'payload', name: 'or-true', value: { 'PAYLOAD': "' OR 1=1--" } },
    ],
    'idor': [
      { type: 'payload', name: 'increment-id', value: { 'TARGET_ID': '1' } },
      { type: 'payload', name: 'decrement-id', value: { 'TARGET_ID': '0' } },
      { type: 'payload', name: 'large-id', value: { 'TARGET_ID': '999999' } },
    ],
    'authorization': [
      { type: 'payload', name: 'no-auth', value: { 'AUTH_HEADER': '' } },
      { type: 'payload', name: 'expired-token', value: { 'AUTH_HEADER': 'Bearer expired' } },
      { type: 'payload', name: 'invalid-token', value: { 'AUTH_HEADER': 'Bearer invalid.token.here' } },
    ],
    'business-logic': [
      { type: 'payload', name: 'negative-qty', value: { 'QUANTITY': '-1' } },
      { type: 'payload', name: 'zero-qty', value: { 'QUANTITY': '0' } },
      { type: 'payload', name: 'large-qty', value: { 'QUANTITY': '999999' } },
    ],
  }

  return payloadSets[category] || [
    { type: 'payload', name: 'default', value: { 'PAYLOAD': 'test' } },
  ]
}

export function generateMethodVariants(): Variation[] {
  return [
    { type: 'method', name: 'post', value: { 'METHOD': 'POST' } },
    { type: 'method', name: 'put', value: { 'METHOD': 'PUT' } },
    { type: 'method', name: 'delete', value: { 'METHOD': 'DELETE' } },
    { type: 'method', name: 'patch', value: { 'METHOD': 'PATCH' } },
  ]
}

export function generateContentTypeVariants(): Variation[] {
  return [
    { type: 'content-type', name: 'json', value: { 'CONTENT_TYPE': 'application/json' } },
    { type: 'content-type', name: 'form', value: { 'CONTENT_TYPE': 'application/x-www-form-urlencoded' } },
    { type: 'content-type', name: 'xml', value: { 'CONTENT_TYPE': 'application/xml' } },
  ]
}
