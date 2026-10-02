/**
 * CAPABILITY TEST — can this product actually FIND a vulnerability?
 *
 * This file exists because the repository did not. Every other "should detect"
 * test in this codebase is a component test on synthetic input: har-parser
 * finding a token in a fixture header, replay diffing two JSON objects. They
 * verify that transforms behave. Not one verified that the product, end to end,
 * on real captured traffic, finds a vulnerability that is actually present.
 *
 * The consequence was measured. An entire session of real bug fixes — browser
 * page resolution, CDP capture, observer attachment, secret-name matching,
 * report plumbing — all verified green, all verified live, and the outcome did
 * not move once. The product produced six false positives on a clean
 * application and zero real findings on every target tried. Nothing in the
 * repository would have failed. That is what this file is for.
 *
 * The bar is DISCRIMINATION, not volume. A detector that flags everything is
 * not a detector. Each pair below presents the same application with and
 * without one deliberate vulnerability, and the product must separate them.
 *
 * Real modules are used end to end: parseHarFromObject -> getSecrets ->
 * bridgeHARToGraph. Only the graph store is substituted, and it is a recorder
 * so the assertion is on what the pipeline actually emitted.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@mastra/core/tools', () => ({ createTool: (config: any) => config }))

const recordedFindings: any[] = []
const recordedEndpoints: any[] = []

const mockStore = {
  upsertNode: vi.fn((node: any) => node),
  addEndpoint: vi.fn((data: any) => {
    recordedEndpoints.push(data)
    return { id: `ep_${recordedEndpoints.length}`, type: 'Endpoint', properties: data }
  }),
  addFinding: vi.fn((data: any) => {
    recordedFindings.push(data)
    return { id: `f_${recordedFindings.length}`, type: 'Finding', properties: data }
  }),
  addFact: vi.fn(() => ({ id: 'fact', type: 'Fact', properties: {} })),
  queryNodes: vi.fn(() => []),
  queryEdges: vi.fn(() => []),
  save: vi.fn().mockResolvedValue(undefined),
}

vi.mock('../../src/graph/store', () => ({ getGlobalGraphStore: () => mockStore }))
vi.mock('../../src/analysis/analyser', () => ({ runAnalysis: vi.fn().mockResolvedValue(undefined) }))

import { parseHarFromObject, getEntries, getSecrets } from '../../src/capture/har-parser'
import { bridgeHARToGraph } from '../../src/analysis/har-bridge'

/** Build a one-entry HAR whose response body is `body`. */
function harWithBody(url: string, body: string) {
  return {
    log: {
      version: '1.2',
      creator: { name: 'test', version: '1.0' },
      entries: [
        {
          startedDateTime: '2026-01-01T00:00:00.000Z',
          time: 100,
          request: {
            method: 'GET',
            url,
            cookies: [],
            headers: [{ name: 'Accept', value: 'application/json' }],
            queryString: [],
          },
          response: {
            status: 200,
            cookies: [],
            headers: [{ name: 'Content-Type', value: 'application/json' }],
            content: { size: body.length, mimeType: 'application/json', text: body },
          },
          timings: { send: 10, wait: 80, receive: 10 },
        },
      ],
    },
  }
}

async function runBridge(url: string, body: string) {
  const harJson = JSON.stringify(harWithBody(url, body))
  const result = await bridgeHARToGraph(harJson, url)
  return result
}

/** Every secret class the pipeline emitted for this run. */
function findingClasses(): string[] {
  return recordedFindings.map(f => String(f.type ?? f.technique ?? ''))
}

beforeEach(() => {
  recordedFindings.length = 0
  recordedEndpoints.length = 0
  vi.clearAllMocks()
})

// ---------------------------------------------------------------------------
// PAIR 1 — the vulnerability that matters, and the clean app it hides in.
// AWS's own published example credentials. Unambiguous by shape, safe to use,
// and exactly the case a real leak presents.
// ---------------------------------------------------------------------------

const VULNERABLE_BODY = JSON.stringify({
  region: 'us-east-1',
  aws_access_key_id: 'AKIAIOSFODNN7EXAMPLE',
  aws_secret_access_key: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
})

const CLEAN_BODY = JSON.stringify({
  region: 'us-east-1',
  endpoint: 'https://api.internal.example',
  retries: 3,
  timeoutMs: 5000,
})

describe('capability: does it find a real, unambiguous vulnerability?', () => {
  it('flags an app with exposed cloud credentials', async () => {
    const result = await runBridge('https://app.test/config.json', VULNERABLE_BODY)
    expect(result.secretsWritten).toBeGreaterThan(0)
    expect(recordedFindings.length).toBeGreaterThan(0)
  })

  it('stays silent on the identical app without them', async () => {
    await runBridge('https://app.test/config.json', CLEAN_BODY)
    expect(recordedFindings.length).toBe(0)
  })

  it('discriminates: the pair differs only by the credential', () => {
    // Guard against a "detector" that simply fires on any config-shaped body.
    const vuln = getSecrets(getEntries(parseHarFromObject(harWithBody('https://app.test/config.json', VULNERABLE_BODY))))
    const clean = getSecrets(getEntries(parseHarFromObject(harWithBody('https://app.test/config.json', CLEAN_BODY))))
    expect(vuln.length).toBeGreaterThan(clean.length)
    expect(clean.length).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// PAIR 2 — THE REGRESSION THAT MATTERS MOST.
//
// Every live run of this product against a clean application produced findings
// of the form "Secret Exposure: session", all of them on socket.io handshake
// URLs. Those were our own unauthenticated websocket ids, not leaked
// credentials. If this pair ever fails again, the product has gone back to
// reporting noise, and no amount of green elsewhere matters.
// ---------------------------------------------------------------------------

const SOCKET_IO_HANDSHAKE = JSON.stringify({
  sid: 'aZQ2bC4dEfGh1iJkLmNoP',
  upgrades: ['websocket'],
  pingInterval: 25000,
  pingTimeout: 5000,
})

describe('capability: it does not invent findings on ordinary traffic', () => {
  it('produces NO finding for a websocket handshake body', async () => {
    await runBridge('https://app.test/socket.io/?EIO=4&transport=polling&t=abc', SOCKET_IO_HANDSHAKE)
    expect(recordedFindings.length).toBe(0)
  })

  it('treats a transport session id as a transport id, not a credential', () => {
    const secrets = getSecrets(getEntries(parseHarFromObject(
      harWithBody('https://app.test/socket.io/', SOCKET_IO_HANDSHAKE),
    )))
    expect(secrets.filter(s => s.location === 'body')).toEqual([])
  })

  it('does not flag ordinary application text as a secret', () => {
    // A translation string containing the word "password" is not a credential.
    // This exact false positive shipped twice in earlier runs.
    const i18n = JSON.stringify({
      login: { label: 'Password', hint: 'Enter your password to continue' },
      logout: 'Sign out',
    })
    const secrets = getSecrets(getEntries(parseHarFromObject(harWithBody('https://app.test/i18n/en.json', i18n))))
    expect(secrets.filter(s => s.location === 'body')).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// The bottom line, stated once so it cannot drift.
// ---------------------------------------------------------------------------

describe('capability: the honest scorecard', () => {
  it('finds what is there, and only what is there', async () => {
    await runBridge('https://app.test/config.json', VULNERABLE_BODY)
    const truePositives = recordedFindings.length

    recordedFindings.length = 0
    await runBridge('https://app.test/config.json', CLEAN_BODY)
    await runBridge('https://app.test/socket.io/', SOCKET_IO_HANDSHAKE)
    const falsePositives = recordedFindings.length

    // Both halves are load-bearing. A product that finds nothing is useless; a
    // product that reports everything is worse, because it spends the operator's
    // credibility on noise.
    expect(truePositives).toBeGreaterThan(0)
    expect(falsePositives).toBe(0)
  })
})