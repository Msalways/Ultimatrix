import { describe, it, expect, beforeEach } from 'vitest'
import { GraphStore } from '../../src/graph/store'

describe('mergeEndpoint — read-before-write enrichment', () => {
  let store: GraphStore

  beforeEach(() => {
    store = new GraphStore()
  })

  it('preserves existing richer data when merging thinner data', () => {
    store.addEndpoint({
      url: 'https://example.com/api/users',
      method: 'GET',
      authRequired: true,
      authType: 'bearer',
      params: [{ name: 'id', type: 'string', in: 'path' }],
      tags: ['user-facing'],
      source: 'har-bridge',
    })

    store.mergeEndpoint({
      url: 'https://example.com/api/users',
      method: 'GET',
      headers: [{ name: 'Authorization', value: 'Bearer abc123' }],
      source: 'passive-observer',
      tags: ['auto-discovered'],
    })

    const endpoints = store.queryNodes()
    const ep = endpoints[0]
    const props = ep.properties as Record<string, unknown>
    expect(props.authType).toBe('bearer')
    expect(props.authRequired).toBe(true)
    expect(props.params).toHaveLength(1)
    expect((props.params as any[])[0].name).toBe('id')
    expect(String(props.source)).toContain('har-bridge')
    expect(String(props.source)).toContain('passive-observer')
    expect(props.tags).toContain('user-facing')
    expect(props.tags).toContain('auto-discovered')
    const headers = props.headers as any[]
    expect(headers).toHaveLength(1)
    expect(headers[0].name).toBe('Authorization')
  })

  it('creates new endpoint when not found', () => {
    store.mergeEndpoint({
      url: 'https://example.com/api/new',
      method: 'POST',
      source: 'passive-observer',
      tags: ['auto-discovered'],
    })

    const endpoints = store.queryNodes()
    expect(endpoints).toHaveLength(1)
    const props = endpoints[0].properties as Record<string, unknown>
    expect(props.url).toBe('https://example.com/api/new')
    expect(props.method).toBe('POST')
  })

  it('merges new headers without duplicating existing ones', () => {
    store.addEndpoint({
      url: 'https://example.com/api/data',
      method: 'GET',
      headers: [{ name: 'Authorization', value: 'Bearer x' }],
    })

    store.mergeEndpoint({
      url: 'https://example.com/api/data',
      method: 'GET',
      headers: [
        { name: 'authorization', value: 'Bearer y' },
        { name: 'X-Custom', value: 'val' },
      ],
    })

    const endpoints = store.queryNodes()
    const headers = (endpoints[0].properties as Record<string, unknown>).headers as any[]
    expect(headers).toHaveLength(2)
    const names = headers.map(h => h.name.toLowerCase())
    expect(names).toContain('authorization')
    expect(names).toContain('x-custom')
  })
})

describe('mergePage — read-before-write enrichment', () => {
  let store: GraphStore

  beforeEach(() => {
    store = new GraphStore()
  })

  it('preserves existing title when merging', () => {
    store.upsertPage('https://example.com', { title: 'Original Title', contentLength: 5000 })

    store.mergePage('https://example.com', { title: 'New Title', contentType: 'text/html' })

    const pages = store.queryNodes()
    const props = pages[0].properties as Record<string, unknown>
    expect(props.title).toBe('Original Title')
    expect(props.contentType).toBe('text/html')
    expect(props.contentLength).toBe(5000)
  })

  it('creates new page when not found', () => {
    store.mergePage('https://example.com/new', { title: 'New Page' })

    const pages = store.queryNodes()
    expect(pages).toHaveLength(1)
    const props = pages[0].properties as Record<string, unknown>
    expect(props.title).toBe('New Page')
  })

  it('merges tags without duplicating', () => {
    store.upsertPage('https://example.com', { tags: ['stagehand'] })

    store.mergePage('https://example.com', { tags: ['stagehand', 'crawled'] })

    const pages = store.queryNodes()
    const props = pages[0].properties as Record<string, unknown>
    expect(props.tags).toEqual(['stagehand', 'crawled'])
  })
})
