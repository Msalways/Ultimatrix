import { vi } from 'vitest'
import { __setTestFallback } from '../../src/runtime/engagement-context'
import { createMockEngagementServices } from './engagement-context'

const { services, cleanup } = createMockEngagementServices()
__setTestFallback(services)

// Cleanup on process exit
if (typeof process !== 'undefined') {
  process.on('exit', () => {
    cleanup()
    __setTestFallback(null)
  })
}