import { describe, it, expect } from 'vitest'
import {
  parameterize,
  generateUserVariants,
  generatePayloadVariants,
  generateMethodVariants,
  generateContentTypeVariants,
} from '../../src/generation/test-parameterizer'
import type { TestCase } from '../../src/generation/test-generator'

const mockTest: TestCase = {
  id: 'test-001',
  name: 'Test IDOR',
  description: 'Test for IDOR vulnerability',
  severity: 'high',
  category: 'authorization',
  code: `import { test, expect } from '@playwright/test'

test('IDOR test', async ({ page }) => {
  const response = await page.request.get('{{URL}}/{{TARGET_ID}}')
  expect(response.status()).toBe(200)
})`,
  findingId: 'finding-001',
}

describe('Test Parameterizer', () => {
  describe('parameterize', () => {
    it('should create parameterized tests', () => {
      const variations = [
        { type: 'payload' as const, name: 'id-1', value: { 'TARGET_ID': '1' } },
        { type: 'payload' as const, name: 'id-2', value: { 'TARGET_ID': '2' } },
      ]
      const tests = parameterize(mockTest, variations)
      expect(tests).toHaveLength(2)
      expect(tests[0].id).toBe('test-001-id-1')
      expect(tests[1].id).toBe('test-001-id-2')
    })

    it('should replace placeholders', () => {
      const variations = [
        { type: 'payload' as const, name: 'v1', value: { 'TARGET_ID': '42' } },
      ]
      const tests = parameterize(mockTest, variations)
      expect(tests[0].code).toContain('42')
      expect(tests[0].code).not.toContain('{{TARGET_ID}}')
    })
  })

  describe('generateUserVariants', () => {
    it('should generate user variants', () => {
      const users = [
        { role: 'user', credentials: { email: 'user@test.com', password: 'pass' } },
        { role: 'admin', credentials: { email: 'admin@test.com', password: 'pass' } },
      ]
      const variants = generateUserVariants(users)
      expect(variants).toHaveLength(2)
      expect(variants[0].name).toBe('user')
      expect(variants[1].name).toBe('admin')
    })
  })

  describe('generatePayloadVariants', () => {
    it('should generate XSS payloads', () => {
      const payloads = generatePayloadVariants('xss')
      expect(payloads.length).toBeGreaterThan(0)
      expect(payloads[0].value['PAYLOAD']).toContain('<script>')
    })

    it('should generate SQLi payloads', () => {
      const payloads = generatePayloadVariants('sqli')
      expect(payloads.length).toBeGreaterThan(0)
      expect(payloads.some(p => p.value['PAYLOAD'].includes("'"))).toBe(true)
    })

    it('should generate IDOR payloads', () => {
      const payloads = generatePayloadVariants('idor')
      expect(payloads.length).toBeGreaterThan(0)
    })

    it('should return default for unknown category', () => {
      const payloads = generatePayloadVariants('unknown')
      expect(payloads).toHaveLength(1)
    })
  })

  describe('generateMethodVariants', () => {
    it('should generate method variants', () => {
      const variants = generateMethodVariants()
      expect(variants).toHaveLength(4)
      expect(variants.map(v => v.value['METHOD'])).toEqual(
        expect.arrayContaining(['POST', 'PUT', 'DELETE', 'PATCH'])
      )
    })
  })

  describe('generateContentTypeVariants', () => {
    it('should generate content type variants', () => {
      const variants = generateContentTypeVariants()
      expect(variants).toHaveLength(3)
      expect(variants.map(v => v.value['CONTENT_TYPE'])).toEqual(
        expect.arrayContaining(['application/json', 'application/x-www-form-urlencoded', 'application/xml'])
      )
    })
  })
})
