import { vi } from 'vitest'
import { runWithEngagementServices, type EngagementServices } from '../../src/runtime/engagement-context'
import { DecisionLedger } from '../../src/security/decision-ledger'
import { ArtifactRegistry } from '../../src/security/artifacts'
import { EvidenceLedger } from '../../src/intelligence/evidence-ledger'
import { UsageTracker } from '../../src/usage/tracker'
import { QuotaTracker } from '../../src/models/quota-tracker'
import { EvidenceGate } from '../../src/intelligence/evidence-gate'
import { TypedEventEmitter } from '../../src/events/emitter'
import { ToolEventEmitter } from '../../src/lib/tool-events'
import { SessionManager } from '../../src/http/session-manager'
import { HumanObserver } from '../../src/capture/human-observer'
import { PassiveObserver } from '../../src/capture/passive-observer'
import { BotDetectionHandler } from '../../src/browser/anti-bot'
import type { UltimatrixConfig } from '../../src/config'

export interface TestEngagementServices {
  services: EngagementServices
  cleanup: () => void
}

/**
 * Minimal test fallback: provides ONLY the services that are fail-closed
 * (throw outside ALS) plus stateless utilities. Deliberately leaves
 * graph/workspace/oast/reactionObserver/dialogWatcher/browserManager/workflow
 * undefined so those resolve to module globals exactly as before — their
 * singleton/reset semantics are asserted by dedicated tests.
 * scopeConfig is null (legacy allow-all) and allowAny true to mirror the
 * suite-wide `setAllowAny(true)` opt-out in test/setup.ts.
 */
export function createMockEngagementServices(): TestEngagementServices {
  const services = {
    workspace: undefined,
    graph: undefined,
    oast: undefined,
    decisions: new DecisionLedger(),
    artifacts: new ArtifactRegistry('test-workflow'),
    evidence: new EvidenceLedger(),
    usage: new UsageTracker(),
    forensicLog: { log: vi.fn() },
    humanObserver: new HumanObserver(),
    reactionObserver: undefined,
    dialogWatcher: undefined,
    recorder: null,
    browserManager: undefined,
    passiveObserver: new PassiveObserver(),
    botHandler: new BotDetectionHandler(),
    oastConfig: null,
    events: new TypedEventEmitter(),
    httpSessions: new SessionManager(),
    quota: new QuotaTracker(),
    toolEvents: new ToolEventEmitter(),
    providerLimiters: new Map(),
    findingState: { evidenceBuffer: new Map(), evidenceGate: new EvidenceGate() },
    scopeConfig: null,
    externalTools: null,
    allowAny: true,
  } as unknown as EngagementServices

  return {
    services,
    cleanup: () => {},
  }
}

export function createTestEngagementServices(_config?: UltimatrixConfig): TestEngagementServices {
  return createMockEngagementServices()
}

export function runInEngagementContext<T>(fn: (services: EngagementServices) => T, config?: UltimatrixConfig): T {
  const { services, cleanup } = createTestEngagementServices(config)
  try {
    return runWithEngagementServices(services, () => fn(services))
  } finally {
    cleanup()
  }
}
