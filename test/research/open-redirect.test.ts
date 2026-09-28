import { describe, it, expect } from 'vitest'
import {
  findLocationEchoes,
  generateHypotheses,
  redirectHypotheses,
} from '../../src/research/hypothesis-engine'
import { planExperiments } from '../../src/research/experiment-planner'
import { compareResearchResponses } from '../../src/research/differential'
import { redirectMarkerUrl, redirectMutation } from '../../src/research/utils'
import type { CapturedRequest } from '../../src/capture/captured-request-store'
import type { GraphStore } from '../../src/graph/store'
import { NodeType, type EndpointNode } from '../../src/graph/schema'
import type { ResearchHypothesis } from '../../src/research/types'

const PAGE = 'https://app.test/redirect/parameter?url=REDIRECTBASE'
const LOCATION_BASE = '/'

function cap(url: string, location?: string): CapturedRequest {
  return {
    id: `cap-${url.length}`,
    method: 'GET',
    url,
    headers: {},
    status: location ? 302 : 200,
    responseHeaders: location ? { location } : {},
    responseBody: '',
    source: 'tool',
    capturedAt: Date.now(),
  }
}

const ep = (id: string, url: string, method = 'GET', params: any[] = []): EndpointNode => ({
  id,
  type: NodeType.ENDPOINT,
  properties: { url, method, params, tags: ['har-capture'], source: 'har-bridge' },
})

function makeStore(endpoints: EndpointNode[]): GraphStore {
  const map = new Map(endpoints.map(e => [e.id, e]))
  return {
    queryNodes: (type: any, _filters?: any) =>
      type === NodeType.ENDPOINT ? [...map.values()] : [],
    getNode: (id: string) => map.get(id),
  } as unknown as GraphStore
}

describe('redirectMarkerUrl / redirectMutation', () => {
  it('is deterministic per endpoint and parameter on a reserved host', () => {
    const a = redirectMarkerUrl(PAGE, 'url')
    expect(a).toBe(redirectMarkerUrl(PAGE, 'url'))
    expect(a).toMatch(/^https:\/\/marker-[0-9a-f]{12}\.example\.com\/$/)
    expect(a).not.toBe(redirectMarkerUrl(PAGE, 'other'))
    expect(a).not.toBe(redirectMarkerUrl('https://app.test/other?url=x', 'url'))
  })

  it('rewrites destination params with per-param marker URLs', () => {
    const { url, markers, rewritten } = redirectMutation(PAGE, ['url'])
    expect(rewritten).toEqual(['url'])
    expect(new URL(url!).searchParams.get('url')).toBe(markers.url)
    expect(markers.url).toBe(redirectMarkerUrl(PAGE, 'url'))
  })

  it('falls back to all query params and reports empty when nothing to mutate', () => {
    const { rewritten } = redirectMutation('https://app.test/r?u=LONGVALUE', ['missing'])
    expect(rewritten).toEqual(['u'])
    expect(redirectMutation('https://app.test/r', ['u'])).toEqual({ url: undefined, markers: {}, rewritten: [] })
    expect(redirectMutation(':::bad:::', ['u'])).toEqual({ url: undefined, markers: {}, rewritten: [] })
  })
})

describe('findLocationEchoes (shape-based, no param-name lists)', () => {
  it('detects a query value echoed verbatim into Location', () => {
    const found = findLocationEchoes([cap('https://app.test/r?url=REDIRECTBASE', 'REDIRECTBASE')])
    expect(found).toHaveLength(1)
    expect(found[0].params).toEqual(['url'])
  })

  it('matches the header name case-insensitively', () => {
    const entry = cap('https://app.test/r?url=REDIRECTBASE', undefined)
    entry.responseHeaders = { Location: 'REDIRECTBASE' }
    expect(findLocationEchoes([entry])).toHaveLength(1)
  })

  it('ignores short values, missing headers, and queryless URLs', () => {
    expect(findLocationEchoes([cap('https://app.test/r?url=/', '/')])).toHaveLength(0)
    expect(findLocationEchoes([cap('https://app.test/r?url=REDIRECTBASE', undefined)])).toHaveLength(0)
    expect(findLocationEchoes([cap('https://app.test/r', 'anything')])).toHaveLength(0)
    expect(findLocationEchoes([cap(':::bad:::', 'REDIRECTBASE')])).toHaveLength(0)
  })

  it('does not count a value absent from Location', () => {
    expect(findLocationEchoes([cap('https://app.test/r?url=REDIRECTBASE', '/home')])).toHaveLength(0)
  })
})

describe('redirectHypotheses', () => {
  const echo = cap('https://app.test/redirect/parameter?url=REDIRECTBASE', 'REDIRECTBASE')

  it('emits open_redirect for a matching graph endpoint', () => {
    const store = makeStore([ep('e1', 'https://app.test/redirect/parameter', 'GET', [{ name: 'url' }])])
    const hs = redirectHypotheses(store, [echo])
    expect(hs).toHaveLength(1)
    expect(hs[0].kind).toBe('open_redirect')
    expect(hs[0].targetEndpoints).toEqual(['e1'])
    expect(hs[0].targetParams).toEqual(['url'])
    expect(hs[0].status).toBe('open')
  })

  it('emits an endpoint-less hypothesis for unmapped echoes, deduplicated per route', () => {
    const captures = [echo, cap('https://app.test/redirect/parameter?url=ANOTHERLONGVALUE', 'ANOTHERLONGVALUE')]
    const hs = redirectHypotheses(makeStore([]), captures)
    expect(hs).toHaveLength(1)
    expect(hs[0].targetEndpoints).toEqual([])
    expect(hs[0].confidence).toBeLessThan(0.5)
  })
})

describe('generateHypotheses wiring', () => {
  it('includes redirect hypotheses alongside other kinds', () => {
    const store = makeStore([ep('e1', 'https://app.test/redirect/parameter', 'GET', [{ name: 'url' }])])
    const echo = cap('https://app.test/redirect/parameter?url=REDIRECTBASE', 'REDIRECTBASE')
    const hs = generateHypotheses(store, [], [], [echo])
    expect(hs.find(h => h.kind === 'open_redirect')).toBeTruthy()
  })

  it('stays quiet without location evidence', () => {
    const store = makeStore([ep('e1', 'https://app.test/redirect/parameter', 'GET', [{ name: 'url' }])])
    expect(generateHypotheses(store, [], [], [cap(PAGE, '/')]).find(h => h.kind === 'open_redirect')).toBeFalsy()
  })
})

describe('planExperiments open_redirect branch', () => {
  it('plans an anonymous marker-URL probe bound to the echoed params', () => {
    const store = makeStore([ep('e1', 'https://app.test/redirect/parameter', 'GET', [{ name: 'url' }])])
    const hypothesis: ResearchHypothesis = {
      id: 'hypothesis:r',
      title: 'redirect',
      kind: 'open_redirect',
      reason: 'location echo observed',
      targetEndpoints: ['e1'],
      targetParams: ['url'],
      relatedWorkflowIds: [],
      relatedEntityIds: [],
      requiredSetup: [],
      risk: 'high',
      confidence: 0.55,
      status: 'open',
    }
    const experiments = planExperiments(store, [hypothesis])
    expect(experiments).toHaveLength(1)
    expect(experiments[0].hypothesisId).toBe('hypothesis:r')
    expect(experiments[0].requiredActors).toEqual(['anonymous'])
    expect(experiments[0].mutation).toContain('url')
    expect(experiments[0].status).toBe('planned')
  })
})

describe('differential location assertion', () => {
  const marker = redirectMarkerUrl(PAGE, 'url')
  const { url: mutatedUrl } = redirectMutation(PAGE, ['url'])
  const base = { status: 302, headers: { location: '/' }, body: '', url: PAGE }
  const mutated = { status: 302, headers: { location: marker }, body: '', url: mutatedUrl }

  it('flags a fresh marker in Location as interesting', () => {
    const result = compareResearchResponses(base, mutated, { markers: [marker] })
    expect(result.interesting).toBe(true)
    expect(result.leakedFields).toContain(`location:${marker}`)
    expect(result.reason).toMatch(/redirect target reflects/i)
  })

  it('stays quiet when the marker was already in the baseline Location', () => {
    const result = compareResearchResponses(
      { ...base, headers: { location: marker } },
      mutated,
      { markers: [marker] },
    )
    expect(result.interesting).toBe(false)
  })

  it('requires the same status for a location echo', () => {
    const result = compareResearchResponses(
      base,
      { ...mutated, status: 500 },
      { markers: [marker] },
    )
    expect(result.interesting).toBe(false)
  })

  it('stays quiet without a marker assertion', () => {
    expect(compareResearchResponses(base, mutated).interesting).toBe(false)
  })

  it('matches Location regardless of header case', () => {
    const result = compareResearchResponses(
      { status: 302, headers: { Location: '/' }, body: '', url: PAGE },
      { status: 302, headers: { Location: marker }, body: '', url: mutatedUrl },
      { markers: [marker] },
    )
    expect(result.interesting).toBe(true)
  })
})
