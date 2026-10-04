import { describe, it, expect } from 'vitest'
import { generateFromFinding, generateSetupCode, generateAssertionCode } from '../../src/generation/test-generator'
import type { Finding } from '../../src/generation/test-generator'

const mockFinding: Finding = {
  id: 'finding-001',
  title: 'IDOR on user profile endpoint',
  severity: 'high',
  category: 'authorization',
  description: 'User A can access User B profile by manipulating the user ID parameter',
  evidence: [
    {
      request: {
        method: 'GET',
        url: 'https://api.example.com/users/456',
        headers: { Authorization: 'Bearer user-a-token' },
      },
      response: {
        status: 200,
        body: '{"id":456,"name":"User B","email":"userb@test.com"}',
      },
      description: 'User A accessed User B profile',
    },
  ],
  request: {
    method: 'GET',
    url: 'https://api.example.com/users/456',
    headers: { Authorization: 'Bearer user-a-token' },
  },
  response: {
    status: 200,
    body: '{"id":456,"name":"User B"}',
  },
  firstSeen: new Date('2026-01-01'),
  lastSeen: new Date('2026-01-01'),
  status: 'open',
}

describe('Test Generator', () => {
  describe('generateFromFinding', () => {
    it('should generate test case from finding', () => {
      const test = generateFromFinding(mockFinding)
      expect(test.id).toBe('test-finding-001')
      expect(test.name).toContain('IDOR')
      expect(test.code).toContain('@playwright/test')
      expect(test.code).toContain('api.example.com')
      expect(test.findingId).toBe('finding-001')
    })

    it('should include evidence steps', () => {
      const test = generateFromFinding(mockFinding)
      expect(test.code).toContain('page.request.get')
      expect(test.code).toContain('https://api.example.com/users/456')
    })

    it('should set correct severity', () => {
      const test = generateFromFinding(mockFinding)
      expect(test.severity).toBe('high')
    })

    it('replays a proven JSON array-growth pair as one executable differential test', () => {
      const finding: Finding = {
        ...mockFinding,
        category: 'sql_injection',
        evidence: [],
        request: { method: 'GET', url: 'http://127.0.0.1:3006/rest/products/search' },
        differentialReplay: {
          baseline: { method: 'GET', url: 'http://127.0.0.1:3006/rest/products/search?q=apple' },
          mutation: { method: 'GET', url: 'http://127.0.0.1:3006/rest/products/search?q=apple%27%29%29%20or%201%3D1--' },
          minimumArrayGrowth: 1,
        },
      }

      const code = generateFromFinding(finding).code
      expect(code).toContain("page.request.get('http://127.0.0.1:3006/rest/products/search?q=apple')")
      expect(code).toContain("page.request.get('http://127.0.0.1:3006/rest/products/search?q=apple%27%29%29%20or%201%3D1--')")
      expect(code).toContain('mutationItems!.length - baselineItems!.length).toBeGreaterThanOrEqual(1)')
      expect(code).not.toContain('should NOT be vulnerable')
      expect(code.match(/const (?:baselineResponse|mutationResponse) =/g)).toHaveLength(2)
    })

    it('uses unique response variables when evidence contains multiple requests', () => {
      const finding: Finding = {
        ...mockFinding,
        evidence: [mockFinding.evidence[0], { ...mockFinding.evidence[0], description: 'Independent replay' }],
      }

      const code = generateFromFinding(finding).code
      expect(code.match(/const response =/g)).toHaveLength(1)
      expect(code.match(/const response2 =/g)).toHaveLength(1)
    })
  })

  describe('generateSetupCode', () => {
    it('should generate login code', () => {
      const code = generateSetupCode({
        user: { email: 'test@test.com', password: 'pass' },
      })
      expect(code).toContain('auth/login')
      expect(code).toContain('TEST_USER_EMAIL')
    })
  })

  describe('generateAssertionCode', () => {
    it('should generate auth assertion', () => {
      const code = generateAssertionCode(mockFinding)
      expect(code).toContain('401')
      expect(code).toContain('403')
    })

    it('should generate info disclosure assertion', () => {
      const infoFinding = { ...mockFinding, category: 'information-disclosure' }
      const code = generateAssertionCode(infoFinding)
      expect(code).toContain('Sensitive information should not be leaked')
      expect(code).toContain('expect(response.status()).toBe(404)')
      expect(code).toContain('password')
    })
  })
})
