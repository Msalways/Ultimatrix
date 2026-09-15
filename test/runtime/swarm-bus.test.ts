import { describe, it, expect, vi } from 'vitest'
import { SwarmBus } from '../../src/runtime/swarm-bus'

describe('SwarmBus', () => {
  describe('publish', () => {
    it('publishes a message', () => {
      const bus = new SwarmBus()
      const msg = bus.publish('finding', 'operator', { title: 'SQLi', severity: 'critical' })
      expect(msg.type).toBe('finding')
      expect(msg.sender).toBe('operator')
      expect(msg.payload.title).toBe('SQLi')
      expect(msg.id).toBeTruthy()
    })

    it('increments message count', () => {
      const bus = new SwarmBus()
      bus.publish('finding', 'a', {})
      bus.publish('endpoint', 'b', {})
      expect(bus.count()).toBe(2)
    })
  })

  describe('subscribe', () => {
    it('receives matching messages', () => {
      const bus = new SwarmBus()
      const received: any[] = []
      bus.subscribe({ types: ['finding'] }, (msg) => received.push(msg))

      bus.publish('finding', 'a', { id: 1 })
      bus.publish('endpoint', 'b', { id: 2 })
      expect(received).toHaveLength(1)
      expect(received[0].payload.id).toBe(1)
    })

    it('filters by sender', () => {
      const bus = new SwarmBus()
      const received: any[] = []
      bus.subscribe({ senders: ['strategist'] }, (msg) => received.push(msg))

      bus.publish('progress', 'strategist', { step: 1 })
      bus.publish('progress', 'operator', { step: 2 })
      expect(received).toHaveLength(1)
      expect(received[0].sender).toBe('strategist')
    })

    it('filters by since timestamp', () => {
      const bus = new SwarmBus()
      bus.publish('finding', 'a', { id: 0 })
      const received: any[] = []
      const future = Date.now() + 100000
      bus.subscribe({ since: future }, (msg) => received.push(msg))
      bus.publish('finding', 'a', { id: 1 })
      // No messages should match since= future
      expect(received).toHaveLength(0)

      // Now subscribe from the past — should get future messages
      const received2: any[] = []
      const past = Date.now() - 100000
      bus.subscribe({ since: past }, (msg) => received2.push(msg))
      bus.publish('finding', 'b', { id: 2 })
      expect(received2).toHaveLength(1)
      expect(received2[0].payload.id).toBe(2)
    })

    it('unsubscribes correctly', () => {
      const bus = new SwarmBus()
      const received: any[] = []
      const unsub = bus.subscribe({}, (msg) => received.push(msg))

      bus.publish('finding', 'a', {})
      unsub()
      bus.publish('finding', 'a', {})
      expect(received).toHaveLength(1)
    })
  })

  describe('getMessages', () => {
    it('returns all messages without filter', () => {
      const bus = new SwarmBus()
      bus.publish('finding', 'a', {})
      bus.publish('endpoint', 'b', {})
      expect(bus.getMessages()).toHaveLength(2)
    })

    it('returns filtered messages', () => {
      const bus = new SwarmBus()
      bus.publish('finding', 'a', {})
      bus.publish('endpoint', 'b', {})
      bus.publish('finding', 'c', {})
      expect(bus.getMessages({ types: ['finding'] })).toHaveLength(2)
    })
  })

  describe('latest', () => {
    it('returns the latest message of a type', () => {
      const bus = new SwarmBus()
      bus.publish('finding', 'a', { id: 1 })
      bus.publish('endpoint', 'b', { id: 2 })
      bus.publish('finding', 'c', { id: 3 })
      expect(bus.latest('finding')?.payload.id).toBe(3)
    })

    it('returns undefined for missing type', () => {
      const bus = new SwarmBus()
      expect(bus.latest('hypothesis')).toBeUndefined()
    })
  })

  describe('clear', () => {
    it('clears all messages', () => {
      const bus = new SwarmBus()
      bus.publish('finding', 'a', {})
      bus.publish('endpoint', 'b', {})
      bus.clear()
      expect(bus.count()).toBe(0)
    })
  })
})
