import { AsyncLocalStorage } from 'node:async_hooks'
import type { ScopeConfig, ExternalToolsConfig, OastConfig } from '../config'
import type { WorkspaceManager } from '../workspace'
import type { GraphStore } from '../graph/store'
import type { OastStore } from '../oast/store'
import type { DecisionLedger } from '../security/decision-ledger'
import type { ArtifactRegistry } from '../security/artifacts'
import type { EvidenceLedger } from '../intelligence/evidence-ledger'
import type { UsageTracker } from '../usage/tracker'
import type { ForensicLog } from '../logging/forensic-log'
import type { HumanObserver } from '../capture/human-observer'
import type { ReactionObserver } from '../browser/reaction-observer'
import type { DialogWatcher } from '../browser/dialog-watcher'
import type { ActionRecorder } from '../recorder'
import type { BrowserManagerState } from '../browser/manager'
import type { PassiveObserver } from '../capture/passive-observer'
import type { BotDetectionHandler } from '../browser/anti-bot'
import type { TypedEventEmitter } from '../events/emitter'
import type { SessionManager } from '../http/session-manager'
import type { QuotaTracker } from '../models/quota-tracker'
import type { ToolEventEmitter } from '../lib/tool-events'
import type { ProviderAwareLimiter } from '../models/provider-limiter'
import type { EvidenceGate } from '../intelligence/evidence-gate'
import type { ObservedFacts } from '../intelligence/evidence-ledger'
import type { TargetTransportGovernor } from './target-governor'
import type { InteractionBroker } from './interaction-broker'
import type { CapturedRequestStore } from '../capture/captured-request-store'

let _testFallback: EngagementServices | null = null

export function __setTestFallback(services: EngagementServices | null): void {
  _testFallback = services
}

export function __getTestFallback(): EngagementServices | null {
  return _testFallback
}

export interface BufferedFindingEvidence {
  /** Stable ledger id when the evidence was recorded through the runtime. */
  id?: string
  type: string
  data: string
  label: string
  timestamp: number
  session?: string
  observed?: ObservedFacts
}

export interface FindingRuntimeState {
  evidenceBuffer: Map<string, BufferedFindingEvidence[]>
  evidenceGate: EvidenceGate | null
}

export interface EngagementServices {
  /** F1 — session model selector (shared cooldown/quota/success state). Optional for legacy-shaped constructions. */
  modelSelector?: import('../models/selector').ModelSelector
  workspace: WorkspaceManager
  graph: GraphStore
  oast: OastStore
  decisions: DecisionLedger
  artifacts: ArtifactRegistry
  evidence: EvidenceLedger
  usage: UsageTracker
  forensicLog: ForensicLog
  humanObserver: HumanObserver
  reactionObserver: ReactionObserver
  dialogWatcher: DialogWatcher
  recorder: ActionRecorder | null
  browserManager: BrowserManagerState
  passiveObserver: PassiveObserver
  botHandler: BotDetectionHandler
  oastConfig: OastConfig | null
  events: TypedEventEmitter
  httpSessions: SessionManager
  quota: QuotaTracker
  toolEvents: ToolEventEmitter
  providerLimiters: Map<string, ProviderAwareLimiter>
  /** Shared wire-level target limiter; absent only in legacy-shaped test doubles. */
  targetGovernor?: TargetTransportGovernor
  /** Shared operator interaction channel for this engagement. */
  interactionBroker?: InteractionBroker
  /** Live browser and tool traffic captured for this engagement. */
  capturedRequests?: CapturedRequestStore
  /** Campaign-local cap checked by the shared HTTP transport before every fetch attempt. */
  campaignRequestBudget?: () => boolean
  interactionMode?: 'ask' | 'run'
  findingState: FindingRuntimeState
  scopeConfig: ScopeConfig | null
  externalTools: ExternalToolsConfig | null
  allowAny: boolean
  /**
   * Live bounty profile is active for this engagement.
   *
   * Engagement-owned rather than read from `getConfig()`: the runtime receives
   * an effective config that a CLI flag (e.g. `--bounty`) may have mutated after
   * validation, and the module-level config cache never sees that mutation.
   * Gates reading the process-global config would silently stand down while the
   * engagement still enforced the profile. Absent only in legacy test doubles.
   */
  bountyEnabled?: boolean
}

const storage = new AsyncLocalStorage<EngagementServices>()

export function getEngagementServices(): EngagementServices | undefined {
  return storage.getStore() ?? _testFallback ?? undefined
}

export function runWithEngagementServices<T>(services: EngagementServices, run: () => T): T {
  return storage.run(services, run)
}
