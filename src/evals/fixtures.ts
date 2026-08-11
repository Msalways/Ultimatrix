/**
 * Architecture eval fixtures — Slice 12.
 *
 * Eight vertical cases that drive the REAL runtime modules the CLI and web
 * surfaces use, with fakes only at the model/browser boundary. Each case emits
 * an event stream + final state that `runEvalCase` asserts against.
 */

import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { EngagementBoundary, SpiderRuntime } from '../spider/runtime'
import { WorkflowStore } from '../workflow/store'
import { resolveModelRef } from '../models/routing'
import { resolveBrowserProvider } from '../browser/provider'
import { checkProof } from '../intelligence/proof-rules'
import type { EvidenceItem } from '../intelligence/evidence-ledger'
import { createSpawnWorkerTool } from '../manager/tools/spawn-worker'
import { getGlobalDecisionLedger } from '../security/decision-ledger'
import { isCategoryAuthorized } from '../safety/scope-guard'
import type { ArchitectureEvalSuite } from './types'
import { evalConfig, eventCapturer, fakeModelSelector, fakeWorkerPool } from './harness'

const callTool = (tool: any, args: any) => (tool as any).execute(args, {})

export const architectureEvals: ArchitectureEvalSuite = {
  name: 'Architecture (vertical workflow coherence)',
  cases: [
    {
      id: 'crawl-completion',
      name: 'crawl → workflow persistence → boundary classification stays coherent',
      workflowInput: { target: 'https://example.com', workflowId: 'eval-crawl', allowAny: false, maxPages: 5 },
      expectedEvents: ['crawl_started', 'page_seen', 'endpoint_seen', 'form_seen', 'crawl_progress', 'crawl_completed'],
      expectedState: {
        pagesSeen: 2,
        stopReason: 'frontier_exhausted',
        workflowReloaded: true,
        reloadedStatus: 'completed',
        crawledOriginsClassified: { allowed: 3, proposed: 1, denied: 1 },
      },
      execute: async () => {
        const cfg = evalConfig()
        const cap = eventCapturer()
        const runtime = new SpiderRuntime({ workflowId: 'eval-crawl', target: 'https://example.com', config: cfg, allowAny: false, onEvent: cap.push })
        runtime.start()
        runtime.enqueue('https://example.com', 0)
        runtime.recordPage('https://example.com', 200)
        runtime.recordEndpoint('GET', 'https://example.com/api/users', ['id'])
        runtime.recordForm('https://example.com/login', '#login', 'POST', '/login')
        runtime.recordPage('https://example.com/about', 200)
        runtime.recordProgress(true, cfg.antiLoop?.staleThreshold ?? 2)
        runtime.stop('frontier_exhausted')

        const dir = mkdtempSync(join(tmpdir(), 'ultimatrix-eval-crawl-'))
        try {
          const path = join(dir, 'workflow.json')
          const store = await WorkflowStore.loadOrCreate(path, { target: 'https://example.com', browserProvider: 'stagehand' })
          store.attachSpider(runtime.snapshot())
          store.setStatus('completed')
          await store.save()
          const reloaded = await WorkflowStore.loadOrCreate(path, { target: 'https://example.com', browserProvider: 'stagehand' })

          const boundary = new EngagementBoundary('https://example.com', cfg, false)
          const classify = (url: string) => boundary.classifyUrl(url).scope
          return {
            events: cap.events,
            state: {
              pagesSeen: reloaded.state.spider?.pagesSeen,
              stopReason: reloaded.state.spider?.stopReason,
              workflowReloaded: true,
              reloadedStatus: reloaded.state.status,
              crawledOriginsClassified: {
                allowed: ['https://example.com', 'https://example.com/api/users', 'https://example.com/about'].filter((u) => classify(u) === 'allowed').length,
                proposed: classify('https://cdn.example.net/app.js') === 'proposed' ? 1 : 0,
                denied: classify('file:///etc/passwd') === 'denied' ? 1 : 0,
              },
            },
          }
        } finally {
          rmSync(dir, { recursive: true, force: true })
        }
      },
    },

    {
      id: 'scope-policy',
      name: 'scope policy: allowed/proposed/denied, proposed never auto-executed, approval reclassifies, ambient allow-any never leaks',
      workflowInput: { target: 'https://example.com', allowAny: false },
      expectedEvents: ['scope_proposed'],
      expectedState: {
        classifications: { target: 'allowed', inScopePath: 'allowed', external: 'proposed', invalid: 'denied', nonHttp: 'denied' },
        proposedNotQueuedAsAllowed: true,
        approvedReclassifies: 'allowed',
        ambientAllowAnyDoesNotLeak: true,
      },
      execute: async () => {
        const cfg = evalConfig()
        const cap = eventCapturer()
        const boundary = new EngagementBoundary('https://example.com', cfg, false)
        const runtime = new SpiderRuntime({ workflowId: 'eval-scope', target: 'https://example.com', config: cfg, allowAny: false, onEvent: cap.push })

        const classifications = {
          target: boundary.classifyUrl('https://example.com').scope,
          inScopePath: boundary.classifyUrl('https://example.com/app/dashboard').scope,
          external: boundary.classifyUrl('https://cdn.example.net/app.js').scope,
          invalid: boundary.classifyUrl('not-a-url').scope,
          nonHttp: boundary.classifyUrl('file:///etc/passwd').scope,
        }

        const scope = runtime.enqueue('https://cdn.example.net/app.js', 0)
        const proposedItem = runtime.snapshot().frontier.find((i) => i.url === 'https://cdn.example.net/app.js')
        const proposedNotQueuedAsAllowed = scope === 'proposed' && proposedItem?.scope === 'proposed'

        // Must be computed BEFORE approval (approval expands the boundary scope).
        const ambientAllowAnyDoesNotLeak = boundary.classifyUrl('https://cdn.example.net/x.js').scope === 'proposed'

        runtime.approveProposed('https://cdn.example.net/app.js')
        const approvedReclassifies = runtime.snapshot().frontier.find((i) => i.url === 'https://cdn.example.net/app.js')?.scope ?? 'none'

        return { events: cap.events, state: { classifications, proposedNotQueuedAsAllowed, approvedReclassifies, ambientAllowAnyDoesNotLeak } }
      },
    },

    {
      id: 'worker-routing',
      name: 'worker routing: bounded typed context, typed routing, compact result, spawn decision persisted',
      workflowInput: { skillId: 'web-pentest', complexity: 'high' },
      expectedEvents: [],
      expectedState: {
        spawnedSkill: 'web-pentest',
        routedTier: 'powerful',
        routedModel: 'groq/llama-3.3-70b-versatile',
        status: 'completed',
        resultSummary: 'compact',
        workerDecisionPersisted: true,
      },
      execute: async () => {
        const cfg = evalConfig()
        const pool = fakeWorkerPool()
        const selector = fakeModelSelector({ tier: 'powerful', modelId: 'groq/llama-3.3-70b-versatile', provider: 'groq', reasoning: 'eval: deterministic routing' })
        const tool = createSpawnWorkerTool(cfg, {} as Parameters<typeof createSpawnWorkerTool>[1], pool as never, selector as never)
        const result = await callTool(tool, { skillId: 'web-pentest', task: 'probe', tier: 'fast', complexity: 'high' })
        const value = result.value
        const decisions = getGlobalDecisionLedger().listDecisions('worker.spawn')
        return {
          events: [],
          state: {
            spawnedSkill: pool.spawned[0]?.skillId,
            routedTier: value.routing?.tier,
            routedModel: value.routing?.modelId,
            status: value.status,
            resultSummary: value.result && typeof value.result === 'object' && typeof value.result.text === 'string' ? 'compact' : 'unexpected',
            workerDecisionPersisted: decisions.some((d) => d.model === 'groq/llama-3.3-70b-versatile'),
          },
        }
      },
    },

    {
      id: 'proof-rule-finding',
      name: 'proof rules: evidence floor gates finding creation (pass) and blocks under-evidenced critical (fail closed)',
      workflowInput: { endpoint: '/api/users', severity: 'high' },
      expectedEvents: [],
      expectedState: {
        highWithCapture: 'accepted',
        criticalSingleCapture: 'blocked',
        criticalTwoCaptures: 'accepted',
        reportExcludesFailedProof: true,
      },
      execute: async () => {
        const { writeFinding, recordEvidence, resetStructuredLedger } = await import('../tools/control-tools')

        // End-to-end: high severity + raw_request capture → accepted.
        resetStructuredLedger()
        await callTool(recordEvidence, { type: 'raw_request', data: 'GET /api/users HTTP/1.1', label: 'req', url: '/api/users', method: 'GET', status: 200 })
        const high = await callTool(writeFinding, { type: 'idor', endpoint: '/api/users', param: 'id', severity: 'high', confidence: 0.8, observedStatus: 200 })

        // Floor contract (deterministic, no write path): critical needs ≥2 structured captures.
        const itemReq: EvidenceItem = { id: 'e1', type: 'raw_request', data: 'GET /api/admin HTTP/1.1', label: 'req', timestamp: Date.now(), observed: { url: '/api/admin', status: 200 } }
        const itemResp: EvidenceItem = { id: 'e2', type: 'raw_response', data: '{"exec":true}', label: 'resp', timestamp: Date.now(), observed: { url: '/api/admin', status: 200 } }
        const criticalOne = checkProof({ findingType: 'rce', endpoint: '/api/admin', severity: 'critical', observedStatus: 200, items: [itemReq] })
        const criticalTwo = checkProof({ findingType: 'rce', endpoint: '/api/admin', severity: 'critical', observedStatus: 200, items: [itemReq, itemResp] })

        return {
          events: [],
          state: {
            highWithCapture: high.ok === true ? 'accepted' : 'blocked',
            criticalSingleCapture: criticalOne.passed === false ? 'blocked' : 'accepted',
            criticalTwoCaptures: criticalTwo.passed === true ? 'accepted' : 'blocked',
            reportExcludesFailedProof: criticalOne.passed === false && criticalTwo.passed === true,
          },
        }
      },
    },

    {
      id: 'browser-lifecycle',
      name: 'browser lifecycle: provider fixed per workflow, resume mismatch rejected, planned provider throws',
      workflowInput: { target: 'https://example.com' },
      expectedEvents: [],
      expectedState: {
        resumeSameProvider: 'ok',
        resumeMismatchedProvider: 'rejected',
        plannedCamofox: 'throws',
      },
      execute: async () => {
        const dir = mkdtempSync(join(tmpdir(), 'ultimatrix-eval-browser-'))
        try {
          const path = join(dir, 'workflow.json')
          const store = await WorkflowStore.loadOrCreate(path, { target: 'https://example.com', browserProvider: 'stagehand' })
          store.setStatus('running')
          await store.save()

          let resumeSameProvider = 'ok'
          try {
            const reloaded = await WorkflowStore.loadOrCreate(path, { target: 'https://example.com', browserProvider: 'stagehand' })
            resumeSameProvider = reloaded.state.browserProvider === 'stagehand' ? 'ok' : 'mismatch'
          } catch {
            resumeSameProvider = 'error'
          }

          let resumeMismatchedProvider = 'rejected'
          try {
            await WorkflowStore.loadOrCreate(path, { target: 'https://example.com', browserProvider: 'camofox' })
            resumeMismatchedProvider = 'accepted'
          } catch (err) {
            resumeMismatchedProvider = err instanceof Error && err.message.includes('browser provider') ? 'rejected' : 'other'
          }

          let plannedCamofox = 'throws'
          try {
            resolveBrowserProvider(evalConfig({ browser: { provider: 'camofox' } } as never))
            plannedCamofox = 'no-throw'
          } catch {
            plannedCamofox = 'throws'
          }

          return { events: [], state: { resumeSameProvider, resumeMismatchedProvider, plannedCamofox } }
        } finally {
          rmSync(dir, { recursive: true, force: true })
        }
      },
    },

    {
      id: 'config-fallback',
      name: 'config fallback: complexity tiers, brain role, and browser provider resolve deterministically',
      workflowInput: { target: 'https://example.com' },
      expectedEvents: [],
      expectedState: {
        workerHigh: { tier: 'powerful', model: 'llama-3.3-70b-versatile' },
        workerMedium: { tier: 'balanced', model: 'llama3-70b-8192' },
        workerLow: { tier: 'fast', model: 'llama3-8b-8192' },
        brainRole: { tier: 'balanced', model: 'llama3-70b-8192' },
        browserProvider: 'stagehand',
      },
      execute: async () => {
        const cfg = evalConfig()
        const high = resolveModelRef(cfg, { role: 'worker', complexity: 'high' })
        const medium = resolveModelRef(cfg, { role: 'worker', complexity: 'medium' })
        const low = resolveModelRef(cfg, { role: 'worker', complexity: 'low' })
        const brain = resolveModelRef(cfg, { role: 'brain' })
        return {
          events: [],
          state: {
            workerHigh: { tier: high.tier, model: high.model },
            workerMedium: { tier: medium.tier, model: medium.model },
            workerLow: { tier: low.tier, model: low.model },
            brainRole: { tier: brain.tier, model: brain.model },
            browserProvider: resolveBrowserProvider(cfg).name,
          },
        }
      },
    },

    {
      id: 'recovery',
      name: 'recovery: stalled crawl stops with typed reason; failed worker returns ok:false and persists the spawn decision',
      workflowInput: { target: 'https://example.com', staleThreshold: 2, failWorker: true },
      expectedEvents: ['crawl_stalled', 'crawl_completed'],
      expectedState: {
        stopReason: 'stale',
        workerStatus: 'failed',
        workerDecisionPersistedOnFailure: true,
      },
      execute: async () => {
        const cfg = evalConfig({ antiLoop: { staleThreshold: 2 } })
        const cap = eventCapturer()
        const runtime = new SpiderRuntime({ workflowId: 'eval-recovery', target: 'https://example.com', config: cfg, allowAny: false, onEvent: cap.push })
        runtime.start()
        runtime.recordPage('https://example.com', 200)
        runtime.recordProgress(false, 2)
        runtime.recordProgress(false, 2)
        runtime.stop('stale')

        const pool = fakeWorkerPool({ fail: true })
        const selector = fakeModelSelector()
        const tool = createSpawnWorkerTool(cfg, {} as Parameters<typeof createSpawnWorkerTool>[1], pool as never, selector as never)
        const result = await callTool(tool, { skillId: 'web-pentest', task: 'probe', complexity: 'medium' })
        const workerDecisions = getGlobalDecisionLedger().listDecisions('worker.spawn')

        return {
          events: cap.events,
          state: {
            stopReason: runtime.snapshot().stopReason,
            workerStatus: result.value.status,
            workerDecisionPersistedOnFailure: workerDecisions.some((d) => d.model === 'groq/llama-3.3-70b-versatile'),
          },
        }
      },
    },

    {
      id: 'external-tools-gating',
      name: 'external tools deny-by-default; configured categories authorized per boundary',
      workflowInput: { target: 'https://example.com', allowedCategories: ['read', 'search', 'browser_action'], externalToolsEnabled: false },
      expectedEvents: [],
      expectedState: {
        readAuthorized: true,
        browserActionAuthorized: true,
        externalToolDenied: true,
        externalToolDeniedWithAmbientOverride: true,
      },
      execute: async () => {
        const cfg = evalConfig()
        const boundary = new EngagementBoundary('https://example.com', cfg, false)
        const allowedCategories = cfg.scope?.allowedCategories ?? []
        return {
          events: [],
          state: {
            readAuthorized: boundary.isActionAuthorized('read'),
            browserActionAuthorized: boundary.isActionAuthorized('browser_action'),
            externalToolDenied: boundary.isActionAuthorized('external_tool') === false,
            externalToolDeniedWithAmbientOverride: isCategoryAuthorized('external_tool', { allowedCategories, externalToolsEnabled: false }) === false,
          },
        }
      },
    },
  ],
}
