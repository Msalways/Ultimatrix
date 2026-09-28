/**
 * Global test setup.
 *
 * Two jobs, both structural rather than per-test workarounds:
 *
 * 1. Scope: the product enforces scope DENY-BY-DEFAULT (gap-analysis P0-3).
 *    Tests opt out via `setAllowAny(true)`, mirroring the runtime `--allow-any`
 *    flag, so the suite is not blocked by the secure default.
 *
 * 2. Config isolation. `getConfigPath()` honours ULTIMATRIX_CONFIG and
 *    `getProvidersPath()` is derived from it, so pointing that one variable at a
 *    temp directory containing a fixture `ultimatrix.yaml` + `providers.yaml`
 *    redirects BOTH. Without this the suite silently depends on the developer's
 *    real config and live credentials: it has failed for anyone whose key is
 *    missing, and it broke whenever the operator's own config changed — which
 *    is not a property a test suite may have. No test should need a real API key
 *    to assert on prompt composition or graph lifecycle.
 */
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { setAllowAny } from '../src/safety/scope-guard'
import { __setTestFallback } from '../src/runtime/engagement-context'
import { createMockEngagementServices } from './utils/engagement-context'

// ── Config isolation (must run before anything imports the config loader) ──
const fixtureDir = mkdtempSync(join(tmpdir(), 'ultimatrix-test-config-'))
writeFileSync(join(fixtureDir, 'providers.yaml'), [
  'openai:',
  '  apiKey: test-openai-key',
  'nvidia:',
  '  apiKey: test-nvidia-key',
  '  baseUrl: https://integrate.api.nvidia.com/v1',
  'openrouter:',
  '  apiKey: test-openrouter-key',
  '  baseUrl: https://openrouter.ai/api/v1/',
  'groq:',
  '  apiKey: test-groq-key',
  'google:',
  '  apiKey: test-google-key',
  'anthropic:',
  '  apiKey: test-anthropic-key',
  'openai-compatible:',
  '  apiKey: test-openai-compatible-key',
  '',
].join('\n'), 'utf8')

writeFileSync(join(fixtureDir, 'ultimatrix.yaml'), [
  'provider: openai',
  'model: gpt-4o',
  'modelTiers:',
  '  fast:',
  '    provider: openai',
  '    model: gpt-4o-mini',
  '  balanced:',
  '    provider: openai',
  '    model: gpt-4o',
  '  powerful:',
  '    provider: openai',
  '    model: gpt-4.1',
  'modelRoleTiers:',
  '  brain: balanced',
  'engine: multi-model',
  'externalTools:',
  '  enabled: false',
  'budgetPolicy:',
  '  enforcement: soft',
  '',
].join('\n'), 'utf8')

process.env.ULTIMATRIX_CONFIG = join(fixtureDir, 'ultimatrix.yaml')

const { services, cleanup } = createMockEngagementServices()
__setTestFallback(services)
setAllowAny(true)

if (typeof process !== 'undefined') {
  process.on('exit', () => {
    cleanup()
    __setTestFallback(null)
    try { rmSync(fixtureDir, { recursive: true, force: true }) } catch { /* best effort */ }
  })
}
