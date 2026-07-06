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
