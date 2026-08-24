import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { createEngagementRuntime } from '../../src/runtime/engagement-runtime'
import { getGlobalGraphStore } from '../../src/graph/store'
import { getGlobalOastStore } from '../../src/oast/store'
import { getGlobalDecisionLedger } from '../../src/security/decision-ledger'
import { getGlobalArtifactRegistry } from '../../src/security/artifacts'
import { getGlobalUsageTracker } from '../../src/usage/tracker'
import { getGlobalWorkspace } from '../../src/workspace'
import { getForensicLog } from '../../src/tools/report-tools'
import { coreEvidenceLedger } from '../../src/core/evidence'
import { getScopeConfig } from '../../src/safety/scope-guard'
import { getGlobalObserver } from '../../src/capture/human-observer'
import { getGlobalReactionObserver } from '../../src/browser/reaction-observer'
import { getGlobalDialogWatcher } from '../../src/browser/dialog-watcher'
import { getGlobalRecorder } from '../../src/recorder'
import { getActiveBrowser, setActiveBrowser } from '../../src/browser/manager'
import { getGlobalObserver as getPassiveObserver } from '../../src/capture/passive-observer'
import { getGlobalBotHandler } from '../../src/browser/anti-bot'
import { emitWorkerSpawned, getGlobalEmitter } from '../../src/events/emitter'
import { getGlobalSessionManager } from '../../src/http/session-manager'
import { getGlobalQuotaTracker } from '../../src/models/quota-tracker'
import { getToolEventEmitter } from '../../src/lib/tool-events'
import { createProviderLimiter } from '../../src/models/limiter-factory'
import { flushEvidence, recordEvidence } from '../../src/tools/control-tools'
import type { BrowserProvider } from '../../src/browser/provider'
import type { UltimatrixConfig } from '../../src/config'

const dirs: string[] = []
const browserProvider: BrowserProvider = {
  name: 'stagehand',
  start: async ({ sessionId }) => ({ sessionId, provider: 'stagehand', browser: {} as any }),
  getActivePage: async () => undefined,
  captureScreenshot: async () => null,
  exportStorage: async () => { throw new Error('unused') },
  close: async () => {},
}

function config(target: string): UltimatrixConfig {
  return {
    provider: 'mock', model: 'mock', target, depth: 1, timeout: 1_000, creds: {},
    browser: { headless: true, viewport: { width: 1280, height: 720 }, domSettleTimeout: 1_000, env: 'LOCAL', selfHeal: true, verbose: 0 },
    memory: { lastMessages: 1, semanticRecall: false, workingMemory: false },
    agent: { maxSteps: 1, scansDir: './scans' },
    scope: { allowedDomains: [new URL(target).hostname] },
  } as UltimatrixConfig
}

afterEach(async () => {
  await Promise.all(dirs.splice(0).map(dir => rm(dir, { recursive: true, force: true })))
})

describe('EngagementRuntime ownership', () => {
  it('isolates overlapping getter-based service calls by engagement', async () => {
    const leftDir = await mkdtemp(join(tmpdir(), 'ultimatrix-engagement-left-'))
    const rightDir = await mkdtemp(join(tmpdir(), 'ultimatrix-engagement-right-'))
    dirs.push(leftDir, rightDir)
    const left = await createEngagementRuntime(config('https://left.example'), 'https://left.example', { outputDir: leftDir, browserProvider })
    const right = await createEngagementRuntime(config('https://right.example'), 'https://right.example', { outputDir: rightDir, browserProvider })
    const eventTasks: string[][] = [[], []]
    const toolMessages: string[][] = [[], []]
    const limiterCapacity: number[] = []
    const findingEvidence: string[][] = [[], []]

    await Promise.all([left, right].map((runtime, index) => runtime.run(async () => {
      const side = index === 0 ? 'left' : 'right'
      await new Promise(resolve => setTimeout(resolve, index === 0 ? 5 : 1))
      getGlobalGraphStore().upsertPage(`https://${side}.example/page`)
      getGlobalOastStore().add({ id: side, url: `https://${side}.example/oast`, method: 'GET', headers: {}, body: '', query: {}, timestamp: index })
      getGlobalDecisionLedger().recordDecision({ kind: side, reason: side })
      getGlobalArtifactRegistry().create('report', { path: `${side}.json` })
      getGlobalUsageTracker().record('mock', side, 10 + index, 1)
      coreEvidenceLedger.record({ id: `evidence-${side}`, type: 'raw_response', data: side, label: side })
      getForensicLog()?.log({ type: 'agent-turn', agent: side })
      expect(getGlobalWorkspace()).toBe(runtime.workspace)
      expect(getScopeConfig()?.allowedDomains).toEqual([`${side}.example`])
      getGlobalEmitter().on('worker:spawned', event => eventTasks[index].push(event.task))
      emitWorkerSpawned(`worker-${side}`, side, 'test', `task-${side}`)
      getGlobalSessionManager().createSession(side, `https://${side}.example`)
      getGlobalQuotaTracker().recordRequest(side)
      getToolEventEmitter().on('event', event => toolMessages[index].push(event.message))
      getToolEventEmitter().push({ type: 'info', message: side, timestamp: index })
      const limiter = createProviderLimiter('mock', {
        ...runtime.config,
        rateLimit: { requestsPerMinute: 10 + index, maxConcurrent: 1, retryOnLimit: false, maxRetries: 0 },
      })
      limiterCapacity[index] = limiter.getAvailable()
      await (recordEvidence.execute as any)({ type: 'text', data: side, label: side })
      findingEvidence[index] = flushEvidence().map(item => item.data)
    })))

    expect(left.graph.queryNodes().map(node => node.id)).toContain('page:https://left.example/page')
    expect(left.graph.queryNodes().map(node => node.id)).not.toContain('page:https://right.example/page')
    expect(left.oast.getAll().map(item => item.id)).toEqual(['left'])
    expect(right.oast.getAll().map(item => item.id)).toEqual(['right'])
    expect(left.decisions.listDecisions().map(item => item.kind)).toEqual(['left'])
    expect(right.artifacts.list().map(item => item.path)).toEqual(['right.json'])
    expect(left.usage.getByModel()).toHaveProperty('mock/left')
    expect(right.evidence.all().map(item => item.label)).toEqual(['right', 'right'])
    expect(left.evidence.all().map(item => item.label)).toEqual(['left', 'left'])
    expect(left.workflow.state.artifacts).toHaveLength(1)
    expect(eventTasks).toEqual([['task-left'], ['task-right']])
    expect(left.services.httpSessions.listSessions()).toEqual(['left'])
    expect(right.services.httpSessions.listSessions()).toEqual(['right'])
    expect(left.services.quota.getStatus()).toHaveProperty('left')
    expect(left.services.quota.getStatus()).not.toHaveProperty('right')
    expect(right.services.quota.getStatus()).toHaveProperty('right')
    expect(toolMessages).toEqual([['left'], ['right']])
    expect(limiterCapacity).toEqual([10, 11])
    expect(findingEvidence).toEqual([['left'], ['right']])

    await Promise.all([left.close({ status: 'completed' }), right.close({ status: 'aborted', reason: 'test' })])
    expect(left.workflow.state.status).toBe('completed')
    expect(right.workflow.state.status).toBe('aborted')

    const resumed = await createEngagementRuntime(config('https://left.example'), 'https://left.example', { outputDir: leftDir, browserProvider })
    expect(resumed.decisions.listDecisions().map(item => item.kind)).toEqual(['left'])
    expect(resumed.workflow.state.decisionLedgerId).toBe('decisions.json')
    await resumed.close({ status: 'completed' })
  })

  it('rejects camofox at browser launch when the Camoufox executable is not provisioned (fail-closed)', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'ultimatrix-engagement-browser-'))
    dirs.push(dir)
    const cfg = config('https://browser.example')
    cfg.browser.provider = 'camofox'
    delete (cfg.browser as any).camofox
    process.env.CAMOUFOX_EXECUTABLE = ''

    // Provider resolves fine; the fail-closed executable check throws when the
    // browser capability actually launches.
    const runtime = await createEngagementRuntime(cfg, cfg.target!, { outputDir: dir })
    await expect(runtime.startBrowser()).rejects.toThrow(/Camoufox Firefox executable/)
    await runtime.dispose()
  })

  it('disposes read-only runtimes without changing workflow status', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'ultimatrix-engagement-dispose-'))
    dirs.push(dir)
    const runtime = await createEngagementRuntime(config('https://report.example'), 'https://report.example', { outputDir: dir, browserProvider })
    const status = runtime.workflow.state.status
    await runtime.dispose()
    expect(runtime.workflow.state.status).toBe(status)
    expect(() => runtime.run(() => undefined)).toThrow('is closed')
  })

  it('isolates observers, recorder, and browser handle across overlapping engagements', async () => {
    const leftDir = await mkdtemp(join(tmpdir(), 'ultimatrix-observers-left-'))
    const rightDir = await mkdtemp(join(tmpdir(), 'ultimatrix-observers-right-'))
    dirs.push(leftDir, rightDir)
    const left = await createEngagementRuntime(config('https://left.example'), 'https://left.example', { outputDir: leftDir, browserProvider })
    const right = await createEngagementRuntime(config('https://right.example'), 'https://right.example', { outputDir: rightDir, browserProvider })
    const handles = [{ close: async () => {} }, { close: async () => {} }]

    const resolved = await Promise.all([left, right].map((runtime, index) => runtime.run(async () => {
      setActiveBrowser(handles[index] as any)
      await new Promise(resolve => setTimeout(resolve, index === 0 ? 5 : 1))
      return {
        human: getGlobalObserver(),
        reaction: getGlobalReactionObserver(),
        dialog: getGlobalDialogWatcher(),
        recorder: getGlobalRecorder(),
        browser: getActiveBrowser(),
        passive: getPassiveObserver(),
        bot: getGlobalBotHandler(),
      }
    })))

    expect(resolved[0].human).toBe(left.services.humanObserver)
    expect(resolved[1].human).toBe(right.services.humanObserver)
    expect(resolved[0].reaction).not.toBe(resolved[1].reaction)
    expect(resolved[0].dialog).not.toBe(resolved[1].dialog)
    expect(resolved[0].recorder).toBe(left.services.recorder)
    expect(resolved[1].recorder).toBe(right.services.recorder)
    expect(resolved[0].passive).not.toBe(resolved[1].passive)
    expect(resolved[0].bot).not.toBe(resolved[1].bot)
    expect(resolved.map(item => item.browser)).toEqual(handles)

    await Promise.all([left.close({ status: 'completed' }), right.close({ status: 'completed' })])
  })

  it('is the production constructor for direct solve and WebEngine', async () => {
    const [solveSource, webSource] = await Promise.all([
      readFile(join(process.cwd(), 'src/cli/solve.ts'), 'utf8'),
      readFile(join(process.cwd(), 'src/web/engine.ts'), 'utf8'),
    ])

    for (const source of [solveSource, webSource]) {
      expect(source).toContain('createEngagementRuntime(')
      expect(source).not.toContain('getOrCreateBrowser(')
      expect(source).not.toContain('WorkflowStore.loadOrCreate(')
    }
  })
})
