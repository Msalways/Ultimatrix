import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import http from 'node:http'
import { httpRequest } from '../../src/tools/http-tools'
import { getGlobalSessionManager } from '../../src/http/session-manager'

let server: any
let port = 0
let capturedHeaders: Record<string, string | string[] | undefined> = {}

beforeAll(async () => {
  server = http.createServer((req, res) => {
    capturedHeaders = req.headers
    res.writeHead(200, { 'content-type': 'text/plain' })
    res.end('ok')
  })
  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      port = (server.address() as any).port
      resolve()
    })
  })
})

afterAll(() => {
  server.close()
})

describe('httpRequest sessionRef (Phase 4)', () => {
  it('merges session headers when sessionRef is provided', async () => {
    const manager = getGlobalSessionManager()
    const sessionName = `test-user:http://127.0.0.1:${port}`
    manager.createSession(sessionName, `http://127.0.0.1:${port}`)
    manager.setToken(sessionName, 'test-jwt-token-123')

    const url = `http://127.0.0.1:${port}/protected`
    const r: any = await (httpRequest.execute as any)({
      method: 'GET',
      url,
      sessionRef: sessionName,
    })
    expect(r.ok).toBe(true)
    expect(capturedHeaders['authorization']).toBe('Bearer test-jwt-token-123')

    manager.removeSession(sessionName)
  })

  it('explicit headers override session headers', async () => {
    const manager = getGlobalSessionManager()
    const sessionName = `test-override:http://127.0.0.1:${port}`
    manager.createSession(sessionName, `http://127.0.0.1:${port}`)
    manager.setToken(sessionName, 'session-token')

    const url = `http://127.0.0.1:${port}/override`
    const r: any = await (httpRequest.execute as any)({
      method: 'GET',
      url,
      sessionRef: sessionName,
      headers: { Authorization: 'Bearer explicit-token' },
    })
    expect(r.ok).toBe(true)
    expect(capturedHeaders['authorization']).toBe('Bearer explicit-token')

    manager.removeSession(sessionName)
  })

  it('works without sessionRef (backward compat)', async () => {
    const url = `http://127.0.0.1:${port}/no-session`
    const r: any = await (httpRequest.execute as any)({
      method: 'GET',
      url,
    })
    expect(r.ok).toBe(true)
    expect(capturedHeaders['authorization']).toBeUndefined()
  })

  it('works with sessionRef that has cookies', async () => {
    const manager = getGlobalSessionManager()
    const sessionName = `test-cookies:http://127.0.0.1:${port}`
    const session = manager.createSession(sessionName, `http://127.0.0.1:${port}`)
    session.cookies['session_id'] = 'abc123'
    session.cookies['csrf_token'] = 'xyz789'

    const url = `http://127.0.0.1:${port}/cookies`
    const r: any = await (httpRequest.execute as any)({
      method: 'GET',
      url,
      sessionRef: sessionName,
    })
    expect(r.ok).toBe(true)
    const cookieHeader = capturedHeaders['cookie'] as string
    expect(cookieHeader).toContain('session_id=abc123')
    expect(cookieHeader).toContain('csrf_token=xyz789')

    manager.removeSession(sessionName)
  })

  it('handles missing sessionRef gracefully (no session found)', async () => {
    const url = `http://127.0.0.1:${port}/missing-session`
    const r: any = await (httpRequest.execute as any)({
      method: 'GET',
      url,
      sessionRef: 'nonexistent-session',
    })
    expect(r.ok).toBe(true)
  })
})
