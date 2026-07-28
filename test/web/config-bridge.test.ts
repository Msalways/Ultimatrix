import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { maskCredentials } from '../../src/web/config-bridge'
import type { UltimatrixConfig } from '../../src/config'

describe('maskCredentials', () => {
  it('masks API keys with ****xxxx pattern', () => {
    const config: UltimatrixConfig = {
      provider: 'groq',
      model: 'test',
      creds: { groq: { apiKey: 'gsk_1234567890abcdef' } },
    }
    const masked = maskCredentials(config)
    expect(masked.creds?.groq?.apiKey).toBe('gsk_****cdef')
  })

  it('masks nested credential objects', () => {
    const config: UltimatrixConfig = {
      provider: 'anthropic',
      model: 'test',
      creds: {
        anthropic: { apiKey: 'sk-ant-1234567890abcdef' },
      },
    }
    const masked = maskCredentials(config)
    expect(masked.creds?.anthropic?.apiKey).toContain('****')
  })

  it('masks short keys entirely', () => {
    const config: UltimatrixConfig = {
      provider: 'groq',
      model: 'test',
      creds: { groq: { apiKey: 'abcd' } },
    }
    const masked = maskCredentials(config)
    expect(masked.creds?.groq?.apiKey).toBe('****')
  })

  it('handles missing creds gracefully', () => {
    const config: UltimatrixConfig = {
      provider: 'groq',
      model: 'test',
      creds: {},
    }
    const masked = maskCredentials(config)
    expect(masked.creds).toEqual({})
  })

  it('does not mutate original config', () => {
    const config: UltimatrixConfig = {
      provider: 'groq',
      model: 'test',
      creds: { groq: { apiKey: 'gsk_secretkey1234567890' } },
    }
    const original = config.creds?.groq?.apiKey
    maskCredentials(config)
    expect(config.creds?.groq?.apiKey).toBe(original)
  })

  it('masks Azure credentials', () => {
    const config: UltimatrixConfig = {
      provider: 'azure',
      model: 'test',
      creds: {
        azure: { apiKey: 'az-key-1234567890abcdef', endpoint: 'https://test.openai.azure.com', deployment: 'gpt-4', apiVersion: '2024-01' },
      },
    }
    const masked = maskCredentials(config)
    expect(masked.creds?.azure?.apiKey).toContain('****')
    expect(masked.creds?.azure?.endpoint).toBe('https://test.openai.azure.com')
  })

  it('masks Bedrock credentials', () => {
    const config: UltimatrixConfig = {
      provider: 'bedrock',
      model: 'test',
      creds: {
        bedrock: { authMethod: 'iam', accessKeyId: 'AKIAIOSFODNN7', secretAccessKey: 'wJalrXUtnFEMI/K7MDENG', region: 'us-east-1' },
      },
    }
    const masked = maskCredentials(config)
    expect(masked.creds?.bedrock?.accessKeyId).toContain('****')
    expect(masked.creds?.bedrock?.secretAccessKey).toContain('****')
  })
})
