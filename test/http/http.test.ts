import { describe, it, expect, vi, beforeEach } from 'vitest'
import { HttpClient } from '../../src/http/client'
import { SessionManager } from '../../src/http/session-manager'

// Mock fetch
const mockFetch = vi.fn()
vi.stubGlobal('fetch', mockFetch)

describe('HttpClient', () => {
  let client: HttpClient

  beforeEach(() => {
    client = new HttpClient('https://api.example.com')
    mockFetch.mockReset()
  })

  it('should make GET request', async () => {
    mockFetch.mockResolvedValue({
      status: 200,
      statusText: 'OK',
      headers: new Map([['content-type', 'application/json']]),
      text: () => Promise.resolve('{"ok":true}'),
    })

    const response = await client.get('/users')
    expect(response.status).toBe(200)
    expect(response.body).toBe('{"ok":true}')
  })

  it('should make POST request', async () => {
    mockFetch.mockResolvedValue({
      status: 201,
      statusText: 'Created',
      headers: new Map(),
      text: () => Promise.resolve('{"id":1}'),
    })

    const response = await client.post('/users', {
      body: { name: 'test' },
    })
    expect(response.status).toBe(201)
  })

  it('should add token', async () => {
    mockFetch.mockResolvedValue({
      status: 200,
      statusText: 'OK',
      headers: new Map(),
      text: () => Promise.resolve(''),
    })

    client.setToken('my-token')
    await client.get('/protected')

    const [, options] = mockFetch.mock.calls[0]
    expect(options.headers['Authorization']).toBe('Bearer my-token')
  })

  it('should add cookies', async () => {
    mockFetch.mockResolvedValue({
      status: 200,
      statusText: 'OK',
      headers: new Map(),
      text: () => Promise.resolve(''),
    })

    client.setCookie('session', 'abc123')
    await client.get('/protected')

    const [, options] = mockFetch.mock.calls[0]
    expect(options.headers['Cookie']).toContain('session=abc123')
  })

  it('should handle network errors', async () => {
    mockFetch.mockRejectedValue(new Error('Network error'))

    const response = await client.get('/unreachable')
    expect(response.status).toBe(0)
    expect(response.body).toContain('Network error')
  })
})

describe('SessionManager', () => {
  let manager: SessionManager

  beforeEach(() => {
    manager = new SessionManager()
  })

  it('should create session', () => {
    const session = manager.createSession('test', 'https://api.example.com')
    expect(session.name).toBe('test')
    expect(session.baseUrl).toBe('https://api.example.com')
  })

  it('should get session', () => {
    manager.createSession('test', 'https://api.example.com')
    const session = manager.getSession('test')
    expect(session).toBeDefined()
    expect(session?.name).toBe('test')
  })

  it('should get client', () => {
    manager.createSession('test', 'https://api.example.com')
    const client = manager.getClient('test')
    expect(client).toBeDefined()
  })

  it('should set token', () => {
    manager.createSession('test', 'https://api.example.com')
    manager.setToken('test', 'my-token')
    const session = manager.getSession('test')
    expect(session?.token).toBe('my-token')
  })

  it('should extract cookies', () => {
    manager.createSession('test', 'https://api.example.com')
    manager.extractCookies('test', {
      headers: { 'set-cookie': 'session=abc123; Path=/' },
    })
    const session = manager.getSession('test')
    expect(session?.cookies['session']).toBe('abc123')
  })

  it('should list sessions', () => {
    manager.createSession('a', 'https://a.com')
    manager.createSession('b', 'https://b.com')
    expect(manager.listSessions()).toEqual(['a', 'b'])
  })

  it('should remove session', () => {
    manager.createSession('test', 'https://api.example.com')
    manager.removeSession('test')
    expect(manager.getSession('test')).toBeUndefined()
  })
})
