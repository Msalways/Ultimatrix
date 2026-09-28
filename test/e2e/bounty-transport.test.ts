import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import http from 'node:http'
import { setScopeConfig, setAllowAny } from '../../src/safety/scope-guard'
import { followRedirects } from '../../src/tools/http-tools'

let first: http.Server
let second: http.Server
let firstOrigin = ''
let secondOrigin = ''
let secondHits = 0

beforeAll(async () => {
  second = http.createServer((_req, res) => {
    secondHits += 1
    res.writeHead(200, { 'content-type': 'text/plain' })
    res.end('out of scope')
  })
  await new Promise<void>((resolve) => second.listen(0, '127.0.0.1', () => resolve()))
  const secondPort = (second.address() as any).port
  secondOrigin = `http://127.0.0.1:${secondPort}`

  first = http.createServer((_req, res) => {
    res.writeHead(302, { location: `${secondOrigin}/should-not-be-reached` })
    res.end()
  })
  await new Promise<void>((resolve) => first.listen(0, '127.0.0.1', () => resolve()))
  const firstPort = (first.address() as any).port
  firstOrigin = `http://127.0.0.1:${firstPort}`
})

afterAll(async () => {
  await new Promise<void>((resolve) => first.close(() => resolve()))
  await new Promise<void>((resolve) => second.close(() => resolve()))
})

describe('authorized bounty transport gate', () => {
  beforeEach(() => {
    secondHits = 0
    setAllowAny(false)
    setScopeConfig({
      allowedDomains: ['127.0.0.1'],
      allowedOrigins: [firstOrigin],
      allowedPorts: [Number(new URL(firstOrigin).port)],
      allowPrivateAddresses: true,
      authorizedPentest: true,
      allowedCategories: ['read'],
      enforcement: 'hard',
    })
  })

  it('blocks a redirect to a second origin before the second request is sent', async () => {
    const result: any = await (followRedirects.execute as any)({ url: `${firstOrigin}/start`, maxHops: 3 })
    expect(result.ok).toBe(false)
    expect(result.error).toMatch(/scope violation on redirect/i)
    expect(secondHits).toBe(0)
  })
})
