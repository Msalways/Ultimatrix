import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import http from 'node:http'
import { httpRequest } from '../../src/tools/http-tools'
import { verifyClaimStructured, resetStructuredLedger } from '../../src/tools/control-tools'

let server: any
let port = 0

beforeAll(async () => {
  server = http.createServer((_req, res) => {
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

describe('httpRequest auto-captures structured evidence (A2)', () => {
  it('records observed facts usable by verification, no prose scanning', async () => {
    resetStructuredLedger()
    const url = `http://127.0.0.1:${port}/api/x`
    const r: any = await (httpRequest.execute as any)({ method: 'GET', url })
    expect(r.ok).toBe(true)
    expect(r.value.status).toBe(200)

    const v = verifyClaimStructured({ type: 'xss', endpoint: url, method: 'GET', observed: { status: 200 } })
    expect(v.verified).toBe(true)
  })

  it('does not verify a claim for a different endpoint', async () => {
    const v = verifyClaimStructured({ type: 'xss', endpoint: 'http://127.0.0.1:9999/nope' })
    expect(v.verified).toBe(false)
  })
})
