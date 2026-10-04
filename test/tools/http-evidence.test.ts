import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import http from 'node:http'
import { getCapturedRequestStore } from '../../src/capture/captured-request-store'
import { httpRequest } from '../../src/tools/http-tools'
import { coreEvidenceLedger } from '../../src/core/evidence'
import { verifyClaimStructured, resetStructuredLedger } from '../../src/tools/control-tools'

const responseBody = JSON.stringify({ data: [{ id: 1 }, { id: 2 }] })

vi.mock('../../src/compression/headroom-service', () => ({
  getCompressionService: () => ({
    compressResponse: async () => ({ compressed: '[context preview]', wasCompressed: true, wasTruncated: true }),
  }),
}))

let server: any
let port = 0

beforeAll(async () => {
  server = http.createServer((_req, res) => {
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end(responseBody)
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
    expect(r.value.body).toBe('[context preview]')
    expect(r.value.evidenceId).toEqual(expect.any(String))
    expect(r.value.capturedRequestId).toEqual(expect.any(String))
    expect(r.value.executionId).toEqual(expect.any(String))

    const evidence = coreEvidenceLedger.get(r.value.evidenceId)
    expect(evidence).toMatchObject({
      type: 'raw_response',
      data: responseBody,
      observed: {
        method: 'GET', url, status: 200,
        responseBody,
        executionId: r.value.executionId,
        captureId: r.value.capturedRequestId,
      },
    })
    expect(getCapturedRequestStore().get(r.value.capturedRequestId)?.responseBody).toBe(responseBody)

    const v = verifyClaimStructured({ type: 'xss', endpoint: url, method: 'GET', observed: { status: 200 } })
    expect(v.verified).toBe(true)
  })

  it('does not verify a claim for a different endpoint', async () => {
    const v = verifyClaimStructured({ type: 'xss', endpoint: 'http://127.0.0.1:9999/nope' })
    expect(v.verified).toBe(false)
  })
})
