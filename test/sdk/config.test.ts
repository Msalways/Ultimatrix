import { describe, it, expect } from 'vitest'
import { validateConfig } from '../../src/config/schema'

describe('Config Schema', () => {
  it('should validate valid config', () => {
    const config = validateConfig({
      target: 'https://api.example.com',
    })
    expect(config.target).toBe('https://api.example.com')
  })

  it('should validate config with credentials', () => {
    const config = validateConfig({
      target: 'https://api.example.com',
      credentials: {
        admin: { email: 'admin@test.com', password: 'pass123' },
      },
    })
    expect(config.credentials?.admin.email).toBe('admin@test.com')
  })

  it('should validate config with browser options', () => {
    const config = validateConfig({
      target: 'https://api.example.com',
      browserOptions: {
        headless: true,
        viewport: { width: 1280, height: 720 },
      },
    })
    expect(config.browserOptions?.headless).toBe(true)
  })

  it('should reject invalid URL', () => {
    expect(() => validateConfig({ target: 'not-a-url' })).toThrow()
  })

  it('should reject invalid email', () => {
    expect(() => validateConfig({
      target: 'https://api.example.com',
      credentials: {
        admin: { email: 'not-an-email', password: 'pass' },
      },
    })).toThrow()
  })

  it('should use defaults for optional fields', () => {
    const config = validateConfig({
      target: 'https://api.example.com',
    })
    expect(config.provider).toBeUndefined()
    expect(config.browserOptions).toBeUndefined()
  })
})
