import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { IncomingMessage, ServerResponse } from 'node:http'

let capturedHandler: ((req: IncomingMessage, res: ServerResponse) => void) | null = null

const mockAddress = vi.fn(() => ({ port: 12345, family: 'IPv4', address: '127.0.0.1' }))
const mockListen = vi.fn((port: any, hostOrCb?: any, cb?: () => void) => {
  if (typeof hostOrCb === 'function') {
    cb = hostOrCb
  }
  if (cb) setTimeout(cb, 0)
  return mockServer
})
const mockServer = {
  listen: mockListen,
  close: vi.fn((cb?: () => void) => {
    if (cb) setTimeout(cb, 0)
  }),
  on: vi.fn(),
  address: mockAddress,
}

vi.mock('node:http', () => ({
  createServer: vi.fn((handler: any) => {
    capturedHandler = handler
    return mockServer
  }),
}))

function mockReq(overrides: Partial<IncomingMessage> & { body?: string } = {}): IncomingMessage {
  const bodyStr = overrides.body ?? ''
  const dataListeners: Array<(chunk: Buffer) => void> = []
  const endListeners: Array<() => void> = []
  const errorListeners: Array<(err: Error) => void> = []

  const req: any = {
    url: '/',
    method: 'GET',
    headers: {},
    socket: { remoteAddress: '127.0.0.1' },
    on: vi.fn((event: string, fn: (...args: any[]) => void) => {
      if (event === 'data') dataListeners.push(fn)
      if (event === 'end') endListeners.push(fn)
      if (event === 'error') errorListeners.push(fn)
      if (event === 'close') { /* noop */ }
    }),
    ...overrides,
  }

  // Override on() to also immediately emit if body is provided
  const origOn = req.on
  req.on = vi.fn((event: string, fn: (...args: any[]) => void) => {
    if (event === 'data' && bodyStr) {
      fn(Buffer.from(bodyStr))
    }
    if (event === 'end') {
      fn()
    }
    if (event === 'error') { /* noop */ }
    return req
  })

  return req
}

function mockRes(): any {
  const state: any = { status: 200, body: '' }
  return {
    writeHead: vi.fn((status: number) => { state.status = status }),
    end: vi.fn((data?: any) => { if (data) state.body = String(data) }),
    on: vi.fn(),
    _getStatus: () => state.status,
    _getBody: () => state.body,
  }
}

async function handleRoute(url: string, method: string, body?: string): Promise<{ status: number; body: any }> {
  if (!capturedHandler) throw new Error('No handler captured')
  const req = mockReq({ url, method, body })
  const res = mockRes()
  await capturedHandler(req, res)
  return { status: res._getStatus(), body: JSON.parse(res._getBody() || '{}') }
}

import { getGlobalOastStore, OastStore } from '../../src/oast/store'
import { EvidenceLedger } from '../../src/intelligence/evidence-ledger'
import { runWithEngagementServices } from '../../src/runtime/engagement-context'

describe('OAST server', () => {
  beforeEach(() => {
    capturedHandler = null
    mockListen.mockClear()
    mockServer.close.mockClear()
    mockAddress.mockClear()
    getGlobalOastStore().clear()
  })

  afterEach(async () => {
    const { stopOastServer } = await import('../../src/oast/server')
    await stopOastServer()
  })

  it('startOastServer returns a port', async () => {
    const { startOastServer, stopOastServer } = await import('../../src/oast/server')
    const port = await startOastServer(0)
    expect(port).toBeGreaterThan(0)
    expect(mockListen).toHaveBeenCalled()
    await stopOastServer()
  })

  it('shares listener readiness across concurrent engagement starts', async () => {
    const { startOastServer } = await import('../../src/oast/server')
    const [leftPort, rightPort] = await Promise.all([
      startOastServer(0, new OastStore()),
      startOastServer(0, new OastStore()),
    ])

    expect(leftPort).toBe(12345)
    expect(rightPort).toBe(12345)
    expect(mockListen).toHaveBeenCalledOnce()
  })

  it('getOastUrl returns correct format after start', async () => {
    const { startOastServer, getOastUrl, stopOastServer } = await import('../../src/oast/server')
    await startOastServer(0)
    const url = getOastUrl()
    expect(url).toMatch(/^http:\/\/localhost:\d+$/)
    await stopOastServer()
  })

  it('health endpoint works', async () => {
    const { startOastServer, stopOastServer } = await import('../../src/oast/server')
    await startOastServer(0)
    const { status, body } = await handleRoute('/health', 'GET')
    expect(status).toBe(200)
    expect(body.ok).toBe(true)
    expect(body.service).toBe('oast')
    await stopOastServer()
  })

  it('root endpoint / works as health', async () => {
    const { startOastServer, stopOastServer } = await import('../../src/oast/server')
    await startOastServer(0)
    const { status, body } = await handleRoute('/', 'GET')
    expect(status).toBe(200)
    expect(body.ok).toBe(true)
    await stopOastServer()
  })

  it('GET /callbacks returns callbacks', async () => {
    const { startOastServer, stopOastServer } = await import('../../src/oast/server')
    await startOastServer(0)

    getGlobalOastStore().add({
      id: 'cb-1',
      url: '/incoming',
      method: 'POST',
      headers: { 'content-type': 'text' },
      body: 'payload',
      query: {},
      timestamp: Date.now(),
    })

    const { status, body } = await handleRoute('/callbacks', 'GET')
    expect(status).toBe(200)
    expect(body.ok).toBe(true)
    expect(body.count).toBe(1)
    expect(body.callbacks).toHaveLength(1)
    expect(body.callbacks[0].id).toBe('cb-1')
    await stopOastServer()
  })

  it('POST to / records a callback', async () => {
    const { startOastServer, stopOastServer } = await import('../../src/oast/server')
    await startOastServer(0)
    const { status, body } = await handleRoute('/payload', 'POST', 'test-body')
    expect(status).toBe(200)
    expect(body.ok).toBe(true)
    expect(body.recorded).toBeTruthy()
    await stopOastServer()
  })

  it('binds callbacks to an explicit engagement store', async () => {
    const { startOastServer, getOastUrl, stopOastServer } = await import('../../src/oast/server')
    const owned = new OastStore()
    await startOastServer(0, owned)
    const path = new URL(getOastUrl(owned)).pathname
    await handleRoute(`${path}/owned`, 'POST', 'engagement-body')
    expect(owned.count()).toBe(1)
    expect(getGlobalOastStore().count()).toBe(0)
    await stopOastServer(owned)
  })

  it('multiplexes engagement stores and keeps the listener until the last owner stops', async () => {
    const { startOastServer, getOastUrl, stopOastServer } = await import('../../src/oast/server')
    const left = new OastStore()
    const right = new OastStore()
    await startOastServer(0, left)
    await startOastServer(0, right)
    const leftPath = new URL(getOastUrl(left)).pathname
    const rightPath = new URL(getOastUrl(right)).pathname

    expect(leftPath).not.toBe(rightPath)
    await handleRoute(`${leftPath}/left`, 'POST')
    await handleRoute(`${rightPath}/right`, 'POST')
    expect(left.getAll().map(item => item.url)).toEqual([`${leftPath}/left`])
    expect(right.getAll().map(item => item.url)).toEqual([`${rightPath}/right`])

    await stopOastServer(left)
    expect(mockServer.close).not.toHaveBeenCalled()
    await handleRoute(`${rightPath}/still-active`, 'POST')
    expect(right.count()).toBe(2)
    await stopOastServer(right)
    expect(mockServer.close).toHaveBeenCalledOnce()
  })

  it('records callback evidence in the routed engagement ledger', async () => {
    const { startOastServer, getOastUrl } = await import('../../src/oast/server')
    const leftStore = new OastStore()
    const rightStore = new OastStore()
    const leftEvidence = new EvidenceLedger()
    const rightEvidence = new EvidenceLedger()
    const leftServices = { oast: leftStore, evidence: leftEvidence, oastConfig: null } as any
    const rightServices = { oast: rightStore, evidence: rightEvidence, oastConfig: null } as any

    await runWithEngagementServices(leftServices, () => startOastServer())
    await runWithEngagementServices(rightServices, () => startOastServer())
    const rightPath = new URL(getOastUrl(rightStore)).pathname
    await handleRoute(`${rightPath}/evidence`, 'POST')

    expect(leftEvidence.all()).toHaveLength(0)
    expect(rightEvidence.all()).toHaveLength(1)
    expect(rightEvidence.all()[0].label).toContain('OAST callback')
  })

  it('rejects unknown engagement routes', async () => {
    const { startOastServer } = await import('../../src/oast/server')
    await startOastServer(0)
    const { status, body } = await handleRoute('/_oast/not-registered/callback', 'POST')
    expect(status).toBe(404)
    expect(body.error).toContain('unknown OAST engagement')
  })

  it('GET /callbacks/:id retrieves specific callback', async () => {
    const { startOastServer, stopOastServer } = await import('../../src/oast/server')
    await startOastServer(0)

    getGlobalOastStore().add({
      id: 'specific-id',
      url: '/unique',
      method: 'GET',
      headers: {},
      body: '',
      query: {},
      timestamp: Date.now(),
    })

    const { status, body } = await handleRoute('/callbacks/specific-id', 'GET')
    expect(status).toBe(200)
    expect(body.ok).toBe(true)
    expect(body.callback.id).toBe('specific-id')
    await stopOastServer()
  })

  it('GET /callbacks/:id returns 404 for missing', async () => {
    const { startOastServer, stopOastServer } = await import('../../src/oast/server')
    await startOastServer(0)
    const { status, body } = await handleRoute('/callbacks/nonexistent', 'GET')
    expect(status).toBe(404)
    expect(body.ok).toBe(false)
    expect(body.error).toContain('not found')
    await stopOastServer()
  })

  it('DELETE /callbacks clears callbacks', async () => {
    const { startOastServer, stopOastServer } = await import('../../src/oast/server')
    await startOastServer(0)

    getGlobalOastStore().add({
      id: 'to-clear',
      url: '/x',
      method: 'GET',
      headers: {},
      body: '',
      query: {},
      timestamp: Date.now(),
    })
    expect(getGlobalOastStore().count()).toBe(1)

    const { status, body } = await handleRoute('/callbacks', 'DELETE')
    expect(status).toBe(200)
    expect(body.cleared).toBe(true)
    expect(getGlobalOastStore().count()).toBe(0)
    await stopOastServer()
  })

  it('stopOastServer works when server is running', async () => {
    const { startOastServer, stopOastServer } = await import('../../src/oast/server')
    await startOastServer(0)
    await stopOastServer()
    expect(mockServer.close).toHaveBeenCalled()
  })

  it('stopOastServer is safe when already stopped', async () => {
    const { stopOastServer } = await import('../../src/oast/server')
    await stopOastServer()
  })
})
