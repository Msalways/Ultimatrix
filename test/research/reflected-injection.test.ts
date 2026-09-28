import { describe, it, expect } from 'vitest'
import {
  findReflectedParams,
  generateHypotheses,
  reflectionHypotheses,
  selectHypotheses,
} from '../../src/research/hypothesis-engine'
import { planExperiments } from '../../src/research/experiment-planner'
import { compareResearchResponses } from '../../src/research/differential'
import { reflectionMarker, reflectionMutation } from '../../src/research/utils'
import type { CapturedRequest } from '../../src/capture/captured-request-store'
import type { GraphStore } from '../../src/graph/store'
import { NodeType, type EndpointNode } from '../../src/graph/schema'
import type { ResearchHypothesis } from '../../src/research/types'

const BODY_URL = 'https://app.test/reflected/parameter/body?q=TESTPROBE'
const BODY_HTML = '<html>\n  <body>\n    TESTPROBE\n  </body>\n</html>'

function cap(url: string, responseBody?: string): CapturedRequest {
  return {
    id: `cap-${url.length}`,
    method: 'GET',
    url,
    headers: {},
    status: 200,
    responseBody,
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

describe('findReflectedParams (shape-based echo detection)', () => {
  it('detects a verbatim query-value echo in the response body', () => {
    const found = findReflectedParams([cap(BODY_URL, BODY_HTML)])
    expect(found).toHaveLength(1)
    expect(found[0].params).toEqual(['q'])
  })

  it('ignores short values as coincidental collisions', () => {
    const found = findReflectedParams([cap('https://app.test/p?a=en', '<html lang="en">open</html>')])
    expect(found).toHaveLength(0)
  })

  it('skips entries without a response body or query string', () => {
    expect(findReflectedParams([cap('https://app.test/p?q=TESTPROBE')])).toHaveLength(0)
    expect(findReflectedParams([cap('https://app.test/p', BODY_HTML)])).toHaveLength(0)
  })

  it('skips malformed URLs without throwing', () => {
    expect(findReflectedParams([cap(':::not a url:::', BODY_HTML)])).toHaveLength(0)
  })

  it('reports multiple echoed params sorted', () => {
    const found = findReflectedParams([cap('https://app.test/p?a=LONGVALUEONE&b=LONGVALUETWO', 'one LONGVALUEONE two LONGVALUETWO')])
    expect(found[0].params).toEqual(['a', 'b'])
  })
})

describe('reflectionHypotheses', () => {
  it('emits reflected_injection for a matching graph endpoint', () => {
    const store = makeStore([ep('e1', 'https://app.test/reflected/parameter/body', 'GET', [{ name: 'q' }])])
    const hs = reflectionHypotheses(store, [cap(BODY_URL, BODY_HTML)])
    expect(hs).toHaveLength(1)
    expect(hs[0].kind).toBe('reflected_injection')
    expect(hs[0].targetEndpoints).toEqual(['e1'])
    expect(hs[0].targetParams).toEqual(['q'])
    expect(hs[0].status).toBe('open')
  })

  it('routes echoes with no corresponding graph endpoint to unmapped hypotheses', () => {
    const hs = reflectionHypotheses(makeStore([]), [cap(BODY_URL, BODY_HTML)])
    expect(hs).toHaveLength(1)
    expect(hs[0].targetEndpoints).toEqual([])
  })

  it('skips static-asset endpoints without recorded params', () => {
    const bare = ep('js', 'https://app.test/static/app.js', 'GET', [])
    const hs = reflectionHypotheses(makeStore([bare]), [cap('https://app.test/static/app.js?v=TESTPROBE', 'TESTPROBE')])
    expect(hs).toHaveLength(0)
  })

  it('matches endpoints regardless of trailing-slash form', () => {
    const store = makeStore([ep('e1', 'https://app.test/reflected/parameter/body/', 'GET', [{ name: 'q' }])])
    const hs = reflectionHypotheses(store, [cap(BODY_URL, BODY_HTML)])
    expect(hs).toHaveLength(1)
    expect(hs[0].targetEndpoints).toEqual(['e1'])
  })

  it('emits an endpoint-less hypothesis for unmapped echoes', () => {
    const hs = reflectionHypotheses(makeStore([]), [cap(BODY_URL, BODY_HTML)])
    expect(hs).toHaveLength(1)
    expect(hs[0].kind).toBe('reflected_injection')
    expect(hs[0].targetEndpoints).toEqual([])
    expect(hs[0].targetParams).toEqual(['q'])
    expect(hs[0].confidence).toBeLessThan(0.5)
  })

  it('deduplicates unmapped echoes per route', () => {
    const captures = [
      cap('https://app.test/p?q=LONGVALUEONE', 'echo LONGVALUEONE here'),
      cap('https://app.test/p?q=LONGVALUETWO', 'echo LONGVALUETWO here'),
    ]
    const hs = reflectionHypotheses(makeStore([]), captures)
    expect(hs).toHaveLength(1)
  })
})

describe('generateHypotheses wiring', () => {
  it('includes reflection hypotheses alongside structural ones', () => {
    const store = makeStore([ep('e1', 'https://app.test/reflected/parameter/body', 'GET', [{ name: 'q' }])])
    const hs = generateHypotheses(store, [], [], [cap(BODY_URL, BODY_HTML)])
    expect(hs.find(h => h.kind === 'reflected_injection')).toBeTruthy()
  })

  it('is backward compatible without captures', () => {
    const store = makeStore([ep('e1', 'https://app.test/reflected/parameter/body', 'GET', [{ name: 'q' }])])
    expect(generateHypotheses(store, [], []).find(h => h.kind === 'reflected_injection')).toBeFalsy()
  })
})

describe('selectHypotheses (kind-diverse cap)', () => {
  const hyp = (id: string, kind: string, confidence: number): ResearchHypothesis => ({
    id,
    title: id,
    kind: kind as ResearchHypothesis['kind'],
    reason: 'test',
    targetEndpoints: [],
    relatedWorkflowIds: [],
    relatedEntityIds: [],
    requiredSetup: [],
    risk: 'medium',
    confidence,
    status: 'open',
  })

  it('passes through when under the cap', () => {
    const list = [hyp('a', 'idor', 0.5), hyp('b', 'reflected_injection', 0.45)]
    expect(selectHypotheses(list, 25)).toEqual(list)
  })

  it('prevents a flooding kind from starving a minority kind', () => {
    const flooded = Array.from({ length: 25 }, (_, i) => hyp(`wb-${i}`, 'workflow_bypass', 0.48))
    const minority = hyp('ri-1', 'reflected_injection', 0.45)
    const selected = selectHypotheses([...flooded, minority], 25)
    expect(selected).toHaveLength(25)
    expect(selected.map(h => h.id)).toContain('ri-1')
  })

  it('orders scarce slots by top-kind confidence, highest first within kind', () => {
    const list = [
      hyp('wb-1', 'workflow_bypass', 0.48),
      hyp('wb-2', 'workflow_bypass', 0.47),
      hyp('ri-1', 'reflected_injection', 0.45),
    ]
    expect(selectHypotheses(list, 2).map(h => h.id)).toEqual(['wb-1', 'ri-1'])
  })

  it('handles empty input and zero cap without throwing', () => {
    expect(selectHypotheses([], 25)).toEqual([])
    expect(selectHypotheses([hyp('a', 'idor', 0.5)], 0)).toEqual([])
  })

  it('reproduces the live starvation case: 25 speculative bypass + 1 backed injection', () => {
    const flooded = Array.from({ length: 25 }, (_, i) => hyp(`wb-${i}`, 'workflow_bypass', 0.48))
    const backed = hyp('ri-live', 'reflected_injection', 0.45)
    const mass = [hyp('ma-1', 'mass_assignment', 0.42), hyp('ma-2', 'mass_assignment', 0.42)]
    const selected = selectHypotheses([...flooded, backed, ...mass], 25)
    const kinds = new Set(selected.map(h => h.kind))
    expect(kinds).toEqual(new Set(['workflow_bypass', 'reflected_injection', 'mass_assignment']))
  })
})

describe('reflectionMarker / reflectionMutation', () => {
  it('is deterministic per endpoint and parameter', () => {
    expect(reflectionMarker(BODY_URL, 'q')).toBe(reflectionMarker(BODY_URL, 'q'))
    expect(reflectionMarker(BODY_URL, 'q')).not.toBe(reflectionMarker(BODY_URL, 'other'))
    expect(reflectionMarker(BODY_URL, 'q')).not.toBe(reflectionMarker('https://app.test/other?q=x', 'q'))
  })

  it('rewrites listed params with per-param markers', () => {
    const { url, markers, rewritten } = reflectionMutation(BODY_URL, ['q'])
    expect(rewritten).toEqual(['q'])
    const parsed = new URL(url!)
    expect(parsed.searchParams.get('q')).toBe(markers.q)
    expect(markers.q).toBe(reflectionMarker(BODY_URL, 'q'))
  })

  it('falls back to all query params when none of the listed ones match', () => {
    const { url, rewritten } = reflectionMutation('https://app.test/p?x=LONGVALUE', ['missing'])
    expect(rewritten).toEqual(['x'])
    expect(new URL(url!).searchParams.get('x')).toContain('marker-')
  })

  it('returns empty when there is nothing to mutate', () => {
    expect(reflectionMutation('https://app.test/p', ['q'])).toEqual({ url: undefined, markers: {}, rewritten: [] })
    expect(reflectionMutation(':::bad:::', ['q'])).toEqual({ url: undefined, markers: {}, rewritten: [] })
  })
})

describe('planExperiments reflected_injection branch', () => {
  it('plans an anonymous marker probe bound to the echoed params', () => {
    const store = makeStore([ep('e1', 'https://app.test/reflected/parameter/body', 'GET', [{ name: 'q' }])])
    const hypothesis: ResearchHypothesis = {
      id: 'hypothesis:x',
      title: 'reflection',
      kind: 'reflected_injection',
      reason: 'echo observed',
      targetEndpoints: ['e1'],
      targetParams: ['q'],
      relatedWorkflowIds: [],
      relatedEntityIds: [],
      requiredSetup: [],
      risk: 'high',
      confidence: 0.55,
      status: 'open',
    }
    const experiments = planExperiments(store, [hypothesis])
    expect(experiments).toHaveLength(1)
    expect(experiments[0].hypothesisId).toBe('hypothesis:x')
    expect(experiments[0].requiredActors).toEqual(['anonymous'])
    expect(experiments[0].mutation).toContain('q')
    expect(experiments[0].status).toBe('planned')
  })
})

describe('differential marker assertion closes the loop', () => {
  it('flags an echoed marker as interesting even on tiny reflection sinks', () => {
    const { url, markers } = reflectionMutation(BODY_URL, ['q'])
    // Preserve surrounding bytes so similarity stays high: only the
    // marker itself differs, exactly like a real reflected echo.
    const mutatedBody = BODY_HTML.replace('TESTPROBE', markers.q)
    const result = compareResearchResponses(
      { status: 200, body: BODY_HTML, url: BODY_URL },
      { status: 200, body: mutatedBody, url },
      { markers: [markers.q] },
    )
    expect(result.interesting).toBe(true)
    expect(result.leakedFields).toContain(`marker:${markers.q}`)
  })

  it('flags the real Firing Range tiny-page shape', () => {
    const tiny = '<html><body>TESTPROBE</body></html>'
    const { url, markers } = reflectionMutation('https://app.test/reflected/parameter/body?q=TESTPROBE', ['q'])
    const result = compareResearchResponses(
      { status: 200, body: tiny, url: BODY_URL },
      { status: 200, body: tiny.replace('TESTPROBE', markers.q), url },
      { markers: [markers.q] },
    )
    expect(result.interesting).toBe(true)
  })

  it('still rejects a different page that happens to contain the marker', () => {
    const { url, markers } = reflectionMutation(BODY_URL, ['q'])
    // Same status, marker present, but the page shape is unrelated (e.g. a
    // generic handler echoing the request URL). Similarity must still veto.
    const unrelated = `<html><head><title>Search results</title></head><body><p>No results for ${markers.q}.</p><ul><li>alpha</li><li>beta</li><li>gamma</li><li>delta</li></ul></body></html>`
    const result = compareResearchResponses(
      { status: 200, body: BODY_HTML, url: BODY_URL },
      { status: 200, body: unrelated, url },
      { markers: [markers.q] },
    )
    expect(result.leakedFields).toContain(`marker:${markers.q}`)
    expect(result.interesting).toBe(false)
  })

  it('stays quiet without a marker assertion', () => {
    const { url, markers } = reflectionMutation(BODY_URL, ['q'])
    const result = compareResearchResponses(
      { status: 200, body: BODY_HTML, url: BODY_URL },
      { status: 200, body: BODY_HTML.replace('TESTPROBE', markers.q), url },
    )
    expect(result.interesting).toBe(false)
  })
})
