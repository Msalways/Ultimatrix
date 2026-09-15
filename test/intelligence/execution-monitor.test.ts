import { describe, it, expect, beforeEach } from 'vitest'
import { ExecutionMonitor, type ToolCallRecord } from '../../src/intelligence/execution-monitor'

describe('ExecutionMonitor', () => {
  let monitor: ExecutionMonitor

  beforeEach(() => {
    monitor = new ExecutionMonitor()
  })

  const makeCall = (toolName: string, overrides?: Partial<ToolCallRecord>): ToolCallRecord => ({
    toolName,
    success: true,
    findingProduced: false,
    timestamp: new Date().toISOString(),
    ...overrides,
  })

  describe('detectRepeatedToolCalls', () => {
    it('detects 3 identical tool calls', () => {
      monitor.recordCall(makeCall('httpRequest'))
      monitor.recordCall(makeCall('httpRequest'))
      monitor.recordCall(makeCall('httpRequest'))

      const patterns = monitor.detectPatterns()
      expect(patterns.some(p => p.type === 'repeated_tool')).toBe(true)
    })

    it('does not flag mixed tools', () => {
      monitor.recordCall(makeCall('httpRequest'))
      monitor.recordCall(makeCall('queryGraph'))
      monitor.recordCall(makeCall('httpRequest'))

      const patterns = monitor.detectPatterns()
      expect(patterns.some(p => p.type === 'repeated_tool')).toBe(false)
    })

    it('respects custom threshold', () => {
      const customMonitor = new ExecutionMonitor({ repeatedToolThreshold: 2 })
      customMonitor.recordCall(makeCall('httpRequest'))
      customMonitor.recordCall(makeCall('httpRequest'))

      const patterns = customMonitor.detectPatterns()
      expect(patterns.some(p => p.type === 'repeated_tool')).toBe(true)
    })
  })

  describe('detectEndpointSaturation', () => {
    it('detects 5 calls to same endpoint', () => {
      for (let i = 0; i < 5; i++) {
        monitor.recordCall(makeCall('httpRequest', { endpoint: '/api/users' }))
      }

      const patterns = monitor.detectPatterns()
      expect(patterns.some(p => p.type === 'endpoint_saturated')).toBe(true)
    })

    it('does not flag when calls spread across endpoints', () => {
      for (let i = 0; i < 3; i++) {
        monitor.recordCall(makeCall('httpRequest', { endpoint: `/api/endpoint-${i}` }))
      }

      const patterns = monitor.detectPatterns()
      expect(patterns.some(p => p.type === 'endpoint_saturated')).toBe(false)
    })
  })

  describe('detectNoFindings', () => {
    it('detects no findings after 10 calls', () => {
      for (let i = 0; i < 10; i++) {
        monitor.recordCall(makeCall('httpRequest'))
      }

      const patterns = monitor.detectPatterns()
      expect(patterns.some(p => p.type === 'no_findings')).toBe(true)
    })

    it('does not flag when findings exist', () => {
      for (let i = 0; i < 10; i++) {
        monitor.recordCall(makeCall('httpRequest', { findingProduced: i === 5 }))
      }

      const patterns = monitor.detectPatterns()
      expect(patterns.some(p => p.type === 'no_findings')).toBe(false)
    })
  })

  describe('detectReconLoop', () => {
    it('detects 8+ recon calls in a row', () => {
      for (let i = 0; i < 8; i++) {
        monitor.recordCall(makeCall('queryGraph'))
      }

      const patterns = monitor.detectPatterns()
      expect(patterns.some(p => p.type === 'recon_loop')).toBe(true)
    })

    it('does not flag when testing is mixed in', () => {
      for (let i = 0; i < 4; i++) {
        monitor.recordCall(makeCall('queryGraph'))
        monitor.recordCall(makeCall('httpRequest'))
      }

      const patterns = monitor.detectPatterns()
      expect(patterns.some(p => p.type === 'recon_loop')).toBe(false)
    })
  })

  describe('detectStuckInjection', () => {
    it('detects 4+ consecutive injection calls', () => {
      for (let i = 0; i < 6; i++) {
        monitor.recordCall(makeCall('httpRequest'))
      }

      const patterns = monitor.detectPatterns()
      expect(patterns.some(p => p.type === 'stuck_injection')).toBe(true)
    })
  })

  describe('getMandatoryInstruction', () => {
    it('returns null when no patterns detected', () => {
      monitor.recordCall(makeCall('queryGraph'))
      expect(monitor.getMandatoryInstruction()).toBeNull()
    })

    it('returns mentor message when pattern detected', () => {
      // Use mixed tools to avoid stuck_injection, but same endpoint to trigger saturation
      monitor.recordCall(makeCall('httpRequest', { endpoint: '/api/users' }))
      monitor.recordCall(makeCall('queryGraph', { endpoint: '/api/users' }))
      monitor.recordCall(makeCall('httpRequest', { endpoint: '/api/users' }))
      monitor.recordCall(makeCall('queryGraph', { endpoint: '/api/users' }))
      monitor.recordCall(makeCall('httpRequest', { endpoint: '/api/users' }))

      const instruction = monitor.getMandatoryInstruction()
      expect(instruction).toContain('[MENTOR]')
      expect(instruction).toBeDefined()
    })
  })

  describe('getCallCount and getFindingCount', () => {
    it('counts calls', () => {
      monitor.recordCall(makeCall('httpRequest'))
      monitor.recordCall(makeCall('queryGraph'))
      expect(monitor.getCallCount()).toBe(2)
    })

    it('counts findings', () => {
      monitor.recordCall(makeCall('httpRequest', { findingProduced: true }))
      monitor.recordCall(makeCall('httpRequest'))
      expect(monitor.getFindingCount()).toBe(1)
    })
  })

  describe('reset', () => {
    it('clears history', () => {
      monitor.recordCall(makeCall('httpRequest'))
      monitor.recordCall(makeCall('httpRequest'))
      monitor.reset()
      expect(monitor.getCallCount()).toBe(0)
    })
  })
})
