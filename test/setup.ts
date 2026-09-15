/**
 * Global test setup. The product enforces scope DENY-BY-DEFAULT (gap-analysis
 * P0-3). Tests opt out via `setAllowAny(true)`, mirroring the runtime
 * `--allow-any` flag, so the suite is not blocked by the secure default.
 */
import { setAllowAny } from '../src/safety/scope-guard'
import { __setTestFallback } from '../src/runtime/engagement-context'
import { createMockEngagementServices } from './utils/engagement-context'

const { services, cleanup } = createMockEngagementServices()
__setTestFallback(services)
setAllowAny(true)

if (typeof process !== 'undefined') {
  process.on('exit', () => {
    cleanup()
    __setTestFallback(null)
  })
}
