import { describe, it, expect, vi } from 'vitest'

vi.mock('@mastra/core/tools', () => ({
  createTool: (config: any) => config,
}))

import { encodeDecode } from '../../src/tools/encode-decode'

const exec = async (operation: string, data: string) =>
  await (encodeDecode as any).execute({ operation, data, _meta: {} })

describe('encodeDecode', () => {
  it('base64 encodes', async () => {
    const result = await exec('base64_encode', 'hello world')
    expect(result.ok).toBe(true)
    expect(result.result).toBe('aGVsbG8gd29ybGQ=')
  })

  it('base64 decodes', async () => {
    const result = await exec('base64_decode', 'aGVsbG8gd29ybGQ=')
    expect(result.ok).toBe(true)
    expect(result.result).toBe('hello world')
  })

  it('hex encodes', async () => {
    const result = await exec('hex_encode', 'hello')
    expect(result.ok).toBe(true)
    expect(result.result).toBe('68656c6c6f')
  })

  it('hex decodes', async () => {
    const result = await exec('hex_decode', '68656c6c6f')
    expect(result.ok).toBe(true)
    expect(result.result).toBe('hello')
  })

  it('hex decodes with 0x prefix', async () => {
    const result = await exec('hex_decode', '0x68656c6c6f')
    expect(result.ok).toBe(true)
    expect(result.result).toBe('hello')
  })

  it('URL encodes', async () => {
    const result = await exec('url_encode', 'hello world&foo=bar')
    expect(result.ok).toBe(true)
    expect(result.result).toContain('hello')
    expect(result.result).toContain('%20')
  })

  it('URL decodes', async () => {
    const result = await exec('url_decode', 'hello%20world%26foo%3Dbar')
    expect(result.ok).toBe(true)
    expect(result.result).toBe('hello world&foo=bar')
  })

  it('HTML encodes', async () => {
    const result = await exec('html_encode', '<script>alert("xss")</script>')
    expect(result.ok).toBe(true)
    expect(result.result).toContain('&lt;')
    expect(result.result).toContain('&gt;')
  })

  it('HTML decodes', async () => {
    const result = await exec('html_decode', '&lt;div&gt;test&lt;/div&gt;')
    expect(result.ok).toBe(true)
    expect(result.result).toBe('<div>test</div>')
  })

  it('JWT decodes', async () => {
    const jwt = 'eyJhbGciOiJIUzI1NiJ9.eyJ1c2VyIjoiYWRtaW4ifQ.test-sig'
    const result = await exec('jwt_decode', jwt)
    expect(result.ok).toBe(true)
    expect(result.result.header.alg).toBe('HS256')
    expect(result.result.payload.user).toBe('admin')
  })

  it('JWT rejects invalid input', async () => {
    const result = await exec('jwt_decode', 'not-a-jwt')
    expect(result.ok).toBe(false)
  })

  it('auto decode detects base64', async () => {
    const result = await exec('auto_decode', 'aGVsbG8=')
    expect(result.ok).toBe(true)
    expect(result.results.some((r: any) => r.method === 'base64')).toBe(true)
  })

  it('auto decode detects URL encoding', async () => {
    const result = await exec('auto_decode', 'hello%20world')
    expect(result.ok).toBe(true)
    expect(result.results.some((r: any) => r.method === 'url')).toBe(true)
  })

  it('auto decode detects JWT', async () => {
    const jwt = 'eyJhbGciOiJIUzI1NiJ9.eyJ1c2VyIjoiYWRtaW4ifQ.sig'
    const result = await exec('jwt_decode', jwt)
    expect(result.ok).toBe(true)
  })

  it('base64 round-trip', async () => {
    const encoded = await exec('base64_encode', 'Ultimatrix v8 test')
    const decoded = await exec('base64_decode', encoded.result)
    expect(decoded.result).toBe('Ultimatrix v8 test')
  })

  it('URL round-trip', async () => {
    const encoded = await exec('url_encode', 'hello world&test=1')
    const decoded = await exec('url_decode', encoded.result)
    expect(decoded.result).toBe('hello world&test=1')
  })
})
