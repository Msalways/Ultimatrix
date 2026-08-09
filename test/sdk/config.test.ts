import { describe, it, expect } from 'vitest'
import { validateConfig } from '../../src/config'

const base = {
  provider: 'groq',
  model: 'test-model',
  creds: { groq: { apiKey: 'test-key' } },
}

describe('Config Schema', () => {
  it('should validate valid config', () => {
    const config = validateConfig({
      ...base,
      target: 'https://api.example.com',
    })
    expect(config.target).toBe('https://api.example.com')
  })

  it('should validate config with credentials', () => {
    const config = validateConfig({
      ...base,
      target: 'https://api.example.com',
      credentials: {
        admin: { email: 'admin@test.com', password: 'pass123' },
      },
    })
    expect(config.credentials?.admin.email).toBe('admin@test.com')
  })

  it('should validate config with browser options', () => {
    const config = validateConfig({
      ...base,
      target: 'https://api.example.com',
      browser: {
        headless: true,
        viewport: { width: 1280, height: 720 },
      },
    })
    expect(config.browser.headless).toBe(true)
  })

  it('should reject invalid URL', () => {
    expect(() => validateConfig({ ...base, target: 'not-a-url' })).toThrow()
  })

  it('should reject invalid email', () => {
    expect(() => validateConfig({
      ...base,
      target: 'https://api.example.com',
      credentials: {
        admin: { email: 'not-an-email', password: 'pass' },
      },
    })).toThrow()
  })

  it('should use defaults for optional fields', () => {
    const config = validateConfig({
      ...base,
      target: 'https://api.example.com',
    })
    expect(config.provider).toBe('groq')
    expect(config.browser.headless).toBe(true)
  })
})
