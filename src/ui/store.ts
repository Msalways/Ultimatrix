/**
 * Terminal UI store — the single source of truth for the Ink-based console.
 *
 * One store instance owns the entire screen's data: the solver RenderModel
 * (chat), findings, spider activity, discovered tools, status bar, the HITL
 * approval request, and the active tab. The Ink app (src/ui/app.tsx) and all
 * panes subscribe; nothing writes to the screen directly.
 *
 * The store is platform-agnostic (no Ink / React imports) so it can be driven
 * from the session runtime and exercised in unit tests without a TTY. This is
 * the structural fix for the previous "five subsystems dumping independently"
 * root cause: the engine folds into `model` exactly once here, and every other
 * surface (logger sink, spider activity, findings) dispatches into the store.
 */

import {
  createRenderModel,
  reduceMessage,
  type RenderModel,
  type Severity,
} from '../output/render-model'
import type { SolverStreamMessage } from '../solver/solver'

export type TabKey = 'chat' | 'findings' | 'spider' | 'tools' | 'status'

export interface SpiderActivity {
  id: string
  name: string
  state: 'start' | 'ok' | 'err'
  detail?: string
  elapsedMs?: number
}

export interface SpiderCounts {
  endpoints: number
  pages: number
  findings: number
}

export interface DiscoveredTool {
  name: string
  lastResult?: string
  lastState?: 'ok' | 'err'
}

export interface StatusInfo {
  engine?: string
  provider?: string
  target?: string
  step: number
  maxSteps?: number
  tools: number
  quota?: string
}

export type RiskLevel = 'low' | 'medium' | 'high'

export interface ApprovalRequest {
  id: string
  name: string
  description?: string
  args?: Record<string, unknown>
  risk: RiskLevel
  timeout?: number
}

export type ApprovalResolution = 'approve' | 'deny' | 'always'

export interface FindingRow {
  id: string
  severity: Severity
  technique: string
  title: string
  endpoint?: string
  detail?: string
}

type Listener = () => void

export class UiStore {
  /** Solver chat model — folded exactly once per stream message (live turn). */
  model: RenderModel = createRenderModel()
  /** Completed turns, oldest first. ChatPane renders history + the live model. */
  turns: RenderModel[] = []
  findings: FindingRow[] = []
  spider: SpiderActivity[] = []
  spiderCounts: SpiderCounts = { endpoints: 0, pages: 0, findings: 0 }
  tools: DiscoveredTool[] = []
  status: StatusInfo = { step: 0, tools: 0 }
  /** Recent system log lines (logger sink forwards here in console mode). */
  logLines: string[] = []
  approval: ApprovalRequest | null = null
  activeTab: TabKey = 'chat'
  /** A question currently awaiting a typed answer from the InputBar (askUser
   *  tool / HITL confirmation). While set, the InputBar submit resolves this
   *  instead of emitting a REPL goal — single input surface, routed by context. */
  pendingInput: string | null = null

  private listeners = new Set<Listener>()
  private approvalWaiters = new Map<string, (r: ApprovalResolution) => void>()

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn)
    return () => this.listeners.delete(fn)
  }

  private notify(): void {
    for (const fn of this.listeners) fn()
  }

  // ── Chat (solver stream) ──────────────────────────────────────────────

  /** Fold one solver stream message into the model (single source of truth). */
  dispatchSolver(msg: SolverStreamMessage): void {
    reduceMessage(this.model, msg)
    this.notify()
  }

  resetChat(): void {
    this.model = createRenderModel()
    this.turns = []
    this.notify()
  }

  /** Snapshot the live turn into history and start a fresh live model. */
  commitTurn(): void {
    this.turns = [...this.turns, this.model]
    this.model = createRenderModel()
    this.notify()
  }

  setChatContext(ctx: { engine?: string; provider?: string; target?: string; goal?: string }): void {
    if (ctx.engine) this.model.engine = ctx.engine
    if (ctx.provider) this.model.provider = ctx.provider
    if (ctx.target) this.model.target = ctx.target
    if (ctx.goal) this.model.goal = ctx.goal
    this.notify()
  }

  // ── Findings ──────────────────────────────────────────────────────────

  addFinding(f: FindingRow): void {
    if (this.findings.some((x) => x.id === f.id)) {
      this.findings = this.findings.map((x) => (x.id === f.id ? f : x))
    } else {
      this.findings = [...this.findings, f]
    }
    this.notify()
  }

  setFindings(list: FindingRow[]): void {
    this.findings = list
    this.notify()
  }

  updateFindingDetail(id: string, detail: string): void {
    this.findings = this.findings.map((x) => (x.id === id ? { ...x, detail } : x))
    this.notify()
  }

  // ── Spider ────────────────────────────────────────────────────────────

  setSpiderActivity(a: SpiderActivity): void {
    const idx = this.spider.findIndex((x) => x.id === a.id)
    if (idx >= 0) {
      this.spider = this.spider.map((x) => (x.id === a.id ? { ...x, ...a } : x))
    } else {
      this.spider = [...this.spider, a]
    }
    this.notify()
  }

  setSpiderCounts(c: Partial<SpiderCounts>): void {
    this.spiderCounts = { ...this.spiderCounts, ...c }
    this.notify()
  }

  // ── Tools ─────────────────────────────────────────────────────────────

  recordTool(t: DiscoveredTool): void {
    const idx = this.tools.findIndex((x) => x.name === t.name)
    if (idx >= 0) {
      this.tools = this.tools.map((x) => (x.name === t.name ? { ...x, ...t } : x))
    } else {
      this.tools = [...this.tools, t]
    }
    this.notify()
  }

  // ── Status ───────────────────────────────────────────────────────────

  setStatus(patch: Partial<StatusInfo>): void {
    this.status = { ...this.status, ...patch }
    this.notify()
  }

  pushLog(line: string): void {
    this.logLines = [...this.logLines.slice(-199), line]
    this.notify()
  }

  // ── HITL approval ─────────────────────────────────────────────────────

  requestApproval(req: ApprovalRequest): Promise<ApprovalResolution> {
    this.approval = req
    this.notify()
    return new Promise<ApprovalResolution>((resolve) => {
      this.approvalWaiters.set(req.id, resolve)
    })
  }

  resolveApproval(res: ApprovalResolution): void {
    const req = this.approval
    if (!req) return
    const waiter = this.approvalWaiters.get(req.id)
    this.approvalWaiters.delete(req.id)
    this.approval = null
    this.notify()
    waiter?.(res)
  }

  // ── Free-text input (askUser tool / HITL) ─────────────────────────────
  // In console mode the readline is absent, so the Ink InputBar is the sole
  // stdin owner. A pending question is shown by the InputBar; its submit
  // resolves the waiter via `resolveInput`.

  requestInput(question: string): Promise<string> {
    this.pendingInput = question
    this.notify()
    return new Promise<string>((resolve) => {
      this.inputWaiter = resolve
    })
  }

  resolveInput(answer: string): void {
    const waiter = this.inputWaiter
    this.inputWaiter = null
    this.pendingInput = null
    this.notify()
    waiter?.(answer)
  }

  private inputWaiter: ((answer: string) => void) | null = null

  // ── Tabs ──────────────────────────────────────────────────────────────

  setTab(tab: TabKey): void {
    if (this.activeTab === tab) return
    this.activeTab = tab
    this.notify()
  }
}

let _store: UiStore | null = null

export function getUiStore(): UiStore {
  if (!_store) _store = new UiStore()
  return _store
}

export function resetUiStore(): void {
  _store = new UiStore()
}
