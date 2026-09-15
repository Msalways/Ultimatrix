import { describe, it, expect, vi, beforeEach } from 'vitest'
import { SPARouteDiscoverer } from '../../src/spider/spa-crawl'

describe('SPACrawl', () => {
  let discoverer: SPARouteDiscoverer

  beforeEach(() => {
    discoverer = new SPARouteDiscoverer({ crawlTimeoutMs: 5000, maxRoutes: 50 })
  })

  describe('addRoute', () => {
    it('records a discovered route', () => {
      discoverer.addRoute('/dashboard', 'pushstate')
      const routes = discoverer.getRoutes()
      expect(routes).toHaveLength(1)
      expect(routes[0].path).toBe('/dashboard')
      expect(routes[0].source).toBe('pushstate')
    })

    it('deduplicates routes by method+path', () => {
      discoverer.addRoute('/api/users', 'pushstate')
      discoverer.addRoute('/api/users', 'network')
      expect(discoverer.getRoutes()).toHaveLength(1)
    })

    it('allows same path with different methods', () => {
      discoverer.addRoute('/api/users', 'network', 'GET')
      discoverer.addRoute('/api/users', 'network', 'POST')
      expect(discoverer.getRoutes()).toHaveLength(2)
    })
  })

  describe('shouldStop', () => {
    it('stops at max routes', () => {
      const small = new SPARouteDiscoverer({ maxRoutes: 3 })
      small.addRoute('/a', 'pushstate')
      small.addRoute('/b', 'pushstate')
      expect(small.shouldStop()).toBe(false)
      small.addRoute('/c', 'pushstate')
      expect(small.shouldStop()).toBe(true)
    })

    it('does not stop before reaching limits', () => {
      expect(discoverer.shouldStop()).toBe(false)
    })
  })

  describe('getStats', () => {
    it('counts routes by source', () => {
      discoverer.addRoute('/a', 'pushstate')
      discoverer.addRoute('/b', 'pushstate')
      discoverer.addRoute('/c', 'network')
      const stats = discoverer.getStats()
      expect(stats.pushstate).toBe(2)
      expect(stats.network).toBe(1)
    })
  })

  describe('clear', () => {
    it('clears all routes', () => {
      discoverer.addRoute('/a', 'pushstate')
      discoverer.addRoute('/b', 'network')
      discoverer.clear()
      expect(discoverer.getRoutes()).toHaveLength(0)
    })
  })
})
