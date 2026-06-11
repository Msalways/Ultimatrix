import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, existsSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { OastStore } from './store'
import type { OastCallback } from './store'

function makeCallback(overrides: Partial<OastCallback> = {}): OastCallback {
  return {
    id: 'cb-1',
    url: '/test',
    method: 'GET',
    headers: {},
    body: '',
    query: {},
    timestamp: Date.now(),
    sourceIp: '127.0.0.1',
    ...overrides,
  }
}

describe('OastStore', () => {
  let store: OastStore

  beforeEach(() => {
    store = new OastStore()
  })

  afterEach(() => {
    const persistPath = join(process.cwd(), 'output', 'oast-callbacks.json')
    if (existsSync(persistPath)) rmSync(persistPath, { force: true })
  })

  describe('add and getAll', () => {
    it('starts empty', () => {
      expect(store.count()).toBe(0)
      expect(store.getAll()).toEqual([])
    })

    it('adds a callback', () => {
      const cb = makeCallback()
      store.add(cb)
      expect(store.count()).toBe(1)
      expect(store.getAll()).toContainEqual(cb)
    })

    it('adds multiple callbacks in order', () => {
      const cb1 = makeCallback({ id: 'cb-1', url: '/a' })
      const cb2 = makeCallback({ id: 'cb-2', url: '/b' })
      store.add(cb1)
      store.add(cb2)
      expect(store.getAll()).toHaveLength(2)
      expect(store.getAll()[0].id).toBe('cb-1')
      expect(store.getAll()[1].id).toBe('cb-2')
    })
  })

  describe('getById', () => {
    it('returns undefined for missing id', () => {
      expect(store.getById('nonexistent')).toBeUndefined()
    })

    it('returns callback by id', () => {
      const cb = makeCallback({ id: 'custom-id' })
      store.add(cb)
      expect(store.getById('custom-id')).toEqual(cb)
    })

    it('returns first match', () => {
      store.add(makeCallback({ id: 'dup-id', url: '/first' }))
      store.add(makeCallback({ id: 'dup-id', url: '/second' }))
      const result = store.getById('dup-id')
      expect(result?.url).toBe('/first')
    })
  })

  describe('getByUrl', () => {
    it('returns empty array for no match', () => {
      store.add(makeCallback({ url: '/api/test' }))
      expect(store.getByUrl('/nonexistent')).toEqual([])
    })

    it('filters by url pattern (substring match)', () => {
      store.add(makeCallback({ id: '1', url: '/api/users' }))
      store.add(makeCallback({ id: '2', url: '/api/products' }))
      store.add(makeCallback({ id: '3', url: '/public' }))
      const result = store.getByUrl('/api')
      expect(result).toHaveLength(2)
      expect(result.map(c => c.id)).toEqual(['1', '2'])
    })
  })

  describe('clear', () => {
    it('clears all callbacks', () => {
      store.add(makeCallback())
      store.add(makeCallback({ id: 'cb-2' }))
      expect(store.count()).toBe(2)
      store.clear()
      expect(store.count()).toBe(0)
      expect(store.getAll()).toEqual([])
    })

    it('is idempotent', () => {
      store.clear()
      expect(store.count()).toBe(0)
    })
  })

  describe('count', () => {
    it('returns correct count', () => {
      expect(store.count()).toBe(0)
      store.add(makeCallback())
      expect(store.count()).toBe(1)
      store.add(makeCallback({ id: 'cb-2' }))
      expect(store.count()).toBe(2)
    })
  })

  describe('maxEntries limit', () => {
    it('trims old entries when max is exceeded', () => {
      const store = new OastStore(3)
      store.add(makeCallback({ id: '1' }))
      store.add(makeCallback({ id: '2' }))
      store.add(makeCallback({ id: '3' }))
      store.add(makeCallback({ id: '4' }))
      expect(store.count()).toBe(3)
      expect(store.getById('1')).toBeUndefined()
      expect(store.getById('4')).toBeDefined()
    })

    it('keeps newest entries when trimming', () => {
      const store = new OastStore(2)
      store.add(makeCallback({ id: 'a' }))
      store.add(makeCallback({ id: 'b' }))
      store.add(makeCallback({ id: 'c' }))
      expect(store.getAll().map(c => c.id)).toEqual(['b', 'c'])
    })
  })

  describe('save and load', () => {
    it('persists and restores callbacks', async () => {
      store.add(makeCallback({ id: 'persist-1', url: '/test' }))
      store.add(makeCallback({ id: 'persist-2', url: '/api' }))
      await store.save()

      const newStore = new OastStore()
      await newStore.load()
      expect(newStore.count()).toBe(2)
      expect(newStore.getById('persist-1')).toBeDefined()
      expect(newStore.getById('persist-2')).toBeDefined()
    })

    it('load handles missing file gracefully', async () => {
      const newStore = new OastStore()
      await newStore.load()
      expect(newStore.count()).toBe(0)
    })

    it('load handles empty array', async () => {
      await store.save()
      const newStore = new OastStore()
      await newStore.load()
      expect(newStore.count()).toBe(0)
    })
  })
})
