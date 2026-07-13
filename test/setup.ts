/**
 * Global test setup. The product enforces scope DENY-BY-DEFAULT (gap-analysis
 * P0-3). Tests opt out via `setAllowAny(true)`, mirroring the runtime
 * `--allow-any` flag, so the suite is not blocked by the secure default.
 */
import { setAllowAny } from '../src/safety/scope-guard'

setAllowAny(true)
