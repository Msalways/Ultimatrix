import { resolve } from 'node:path'
import { BrowserLauncher } from './capture/browser-launcher'
import type { HarArchive } from './capture/har-parser'
import {getEndpointsWithHeaders} from './capture/har-parser'
import { loadAllSkills, getBuiltinSkill } from './analysis/skill-loader'
import type { Skill } from './analysis/skill-loader'
import { analyzeHar, identifyPatterns, generateHypotheses } from './analysis/har-analyzer'
import type { AnalysisResult, Pattern, Hypothesis } from './analysis/har-analyzer'
import { generateFromFinding } from './generation/test-generator'
import type { Finding, TestCase } from './generation/test-generator'
import { TestStorage } from './generation/test-storage'
import { generateReport } from './report/generator'
import { validateConfig, type UltimatrixConfig as RuntimeConfig } from './config'
import type { EngagementRuntime } from './runtime/engagement-runtime'
import { TestRunner, type TestResult } from './replay/test-runner'
import { NodeType, type FindingNode } from './graph/schema'
import { replayExploitProof } from './tools/control-tools'
import type { ArtifactKind, CreateArtifactOptions } from './security/artifacts'

export interface UltimatrixConfig {
  target: string
  credentials?: Record<string, { email: string; password: string }>
  provider?: string
  model?: string
  outputDir?: string
  skillsDir?: string
  browserOptions?: {
    headless?: boolean
    viewport?: { width: number; height: number }
  }
}

export interface ScanResult {
  findings: Finding[]
  candidates: Finding[]
  tests: TestCase[]
  analysis: AnalysisResult
  patterns: Pattern[]
  hypotheses: Hypothesis[]
}

export type ReplayStatus = 'passed' | 'failed' | 'inconclusive' | 'unsupported' | 'execution_error'

export interface ReplayItem {
  testId: string
  findingId: string
  status: ReplayStatus
  durationMs: number
  error?: string
}

export interface ReplayResult {
  passed: number
  failed: number
  skipped: number
  total: number
  executed: boolean
  inconclusive: number
  unsupported: number
  executionErrors: number
  results: ReplayItem[]
}

function replayStatus(result: TestResult): ReplayStatus {
  if (result.status === 'passed') return 'passed'
  if (result.status === 'failed') return 'failed'
  if (result.status === 'error') return 'execution_error'
  return 'inconclusive'
}

export class Ultimatrix {
  private config: UltimatrixConfig
  private browser: BrowserLauncher
  private storage: TestStorage
  private skills: Skill[] = []
  private findings: Finding[] = []
  private candidates: Finding[] = []
  private tests: TestCase[] = []
  private harData: HarArchive | null = null
  private runtimeConfig: RuntimeConfig
  private runtimePromise?: Promise<EngagementRuntime>
  private failure?: string

  constructor(config: UltimatrixConfig) {
    this.config = {
      outputDir: resolve(process.cwd(), 'output'),
      ...config,
    }
    this.browser = new BrowserLauncher()
    this.storage = new TestStorage(this.config.outputDir!)
    this.runtimeConfig = validateConfig({
      provider: this.config.provider ?? 'openai',
      model: this.config.model ?? 'gpt-4o-mini',
      target: this.config.target,
      creds: {},
      credentials: this.config.credentials,
      browser: this.config.browserOptions,
    }, { requireCredentials: false })
  }

  private getRuntime(): Promise<EngagementRuntime> {
    return this.runtimePromise ??= import('./runtime/engagement-runtime').then(({ createEngagementRuntime }) =>
      createEngagementRuntime(this.runtimeConfig, this.config.target, { outputDir: this.config.outputDir }),
    )
  }

  private async withRuntime<T>(operation: (runtime: EngagementRuntime) => Promise<T>): Promise<T> {
    const runtime = await this.getRuntime()
    try {
      return await runtime.run(() => operation(runtime))
    } catch (error) {
      this.failure = error instanceof Error ? error.message : String(error)
      throw error
    }
  }

  async learn(): Promise<AnalysisResult> {
    return this.withRuntime(async runtime => {

    // Load skills
    this.skills = await loadAllSkills(this.config.skillsDir)
    const authSkill = getBuiltinSkill('authorization')
    if (authSkill) {
      this.skills.push({
        name: 'authorization',
        description: 'Authorization testing knowledge',
        content: authSkill,
        category: 'built-in',
        filePath: 'built-in',
      })
    }

    // Capture traffic — use the capture instance from the browser launcher,
    // which is the one actually wired to the page's response events.
    const { page, capture } = await this.browser.newPage({
      headless: this.config.browserOptions?.headless,
      viewport: this.config.browserOptions?.viewport,
    })

    await page.goto(this.config.target)
    await page.waitForLoadState('networkidle')

    // Flush pending async captures, then stop and export.
    await capture.flush()
    capture.stop()
    this.harData = capture.exportHar()

    // Close the page we opened — we're done with it.
    await this.browser.closePage(page)

    // Analyze
    const analysis = analyzeHar(this.harData)
    const patterns = identifyPatterns(this.harData.log.entries)
    generateHypotheses(patterns, analysis.endpoints)

    // Persist endpoints with headers to graph
    const endpointsWithHeaders = getEndpointsWithHeaders(this.harData.log.entries)
    for (const ep of endpointsWithHeaders) {
      runtime.graph.addEndpoint({
          url: ep.url,
          method: ep.method,
          params: ep.params,
          headers: ep.headers,
          authRequired: !!ep.authType,
          authType: ep.authType || undefined,
          source: 'har-capture',
      })
    }

    await runtime.saveCheckpoint('sdk:learn')
    return analysis
    })
  }

  async generate(): Promise<TestCase[]> {
    return this.withRuntime(async () => {
    if (!this.harData) {
      throw new Error('Must call learn() before generate()')
    }

    const analysis = analyzeHar(this.harData)
    const patterns = identifyPatterns(this.harData.log.entries)
    const hypotheses = generateHypotheses(patterns, analysis.endpoints)

    this.candidates = []
    this.tests = []
    // Generate compatibility tests from candidates without promoting them to findings.
    for (const h of hypotheses) {
      const candidate: Finding = {
        id: h.id,
        title: h.title,
        severity: h.confidence > 0.7 ? 'high' : h.confidence > 0.4 ? 'medium' : 'low',
        category: h.patterns[0]?.type || 'unknown',
        description: h.description,
        evidence: [],
        request: {
          method: 'GET',
          url: h.targetEndpoints[0] || this.config.target,
        },
        firstSeen: new Date(),
        lastSeen: new Date(),
        status: 'open',
      }
      this.candidates.push(candidate)
    }

    // Generate tests
    for (const candidate of this.candidates) {
      const test = generateFromFinding(candidate)
      this.tests.push(test)
    }

    // Save tests
    await this.storage.save(this.tests)

    return this.tests
    })
  }

  async replay(): Promise<ReplayResult> {
    return this.withRuntime(async runtime => {
    const verified = (runtime.graph.queryNodes(NodeType.FINDING) as FindingNode[])
      .filter(finding => finding.properties.lifecycleStatus === 'verified')
    const results: ReplayItem[] = []
    for (const finding of verified) {
      const proof = runtime.graph.getExploitProof(finding.properties.findingId).find(item => item.properties.replayable)
      if (!proof) {
        results.push({ testId: finding.properties.findingId, findingId: finding.properties.findingId, status: 'unsupported', durationMs: 0, error: 'replayable exploit proof is missing' })
        continue
      }
      if (!proof.properties.expectedVulnerableResponse) {
        results.push({ testId: proof.id, findingId: finding.properties.findingId, status: 'inconclusive', durationMs: 0, error: 'proof has no deterministic response oracle' })
        continue
      }
      const startedAt = Date.now()
      const replay = await replayExploitProof(proof)
      const status: ReplayStatus = replay.ok
        ? 'passed'
        : !replay.replayed
          ? 'unsupported'
          : replay.note.startsWith('replay error:') || replay.note.includes('timeout/network')
            ? 'execution_error'
            : 'failed'
      results.push({ testId: proof.id, findingId: finding.properties.findingId, status, durationMs: Date.now() - startedAt, ...(!replay.ok ? { error: replay.note } : {}) })
    }

    const tests = verified.length === 0 ? await this.storage.load() : []
    const runner = new TestRunner(this.config.outputDir!)
    for (const test of tests) {
      const execution = await runner.run(test.filePath)
      results.push({
        testId: test.id,
        findingId: test.findingId,
        status: replayStatus(execution),
        durationMs: execution.duration,
        ...(execution.error ? { error: execution.error } : {}),
      })
    }
    const count = (status: ReplayStatus) => results.filter(result => result.status === status).length
    const inconclusive = count('inconclusive')
    const unsupported = count('unsupported')
    return {
      passed: count('passed'),
      failed: count('failed'),
      skipped: inconclusive + unsupported,
      total: results.length,
      executed: results.length > 0,
      inconclusive,
      unsupported,
      executionErrors: count('execution_error'),
      results,
    }
    })
  }

  async scan(): Promise<ScanResult> {
    const analysis = await this.learn()
    const tests = await this.generate()
    const patterns = identifyPatterns(this.harData!.log.entries)
    const hypotheses = generateHypotheses(patterns, analysis.endpoints)

    return {
      findings: this.findings,
      candidates: this.candidates,
      tests,
      analysis,
      patterns,
      hypotheses,
    }
  }

  getFindings(): Finding[] {
    return [...this.findings]
  }

  getCandidates(): Finding[] {
    return [...this.candidates]
  }

  getTests(): TestCase[] {
    return [...this.tests]
  }

  exportReport(format: 'json' | 'html' | 'markdown'): string {
    const results = this.tests.map(t => ({
      testFile: `${t.id}.spec.ts`,
      testName: t.name,
      status: 'not-run' as const,
      duration: 0,
      executed: false,
    }))

    return generateReport(this.findings, results, { format })
  }

  async registerArtifact(kind: ArtifactKind, options: CreateArtifactOptions): Promise<void> {
    await this.withRuntime(async runtime => {
      runtime.artifacts.create(kind, options)
      await runtime.saveCheckpoint(`sdk:artifact:${kind}`)
    })
  }

  async close(): Promise<void> {
    try {
      await this.browser.close()
    } finally {
      if (this.runtimePromise) {
        const runtime = await this.runtimePromise
        await runtime.close(this.failure ? { status: 'failed', error: this.failure } : { status: 'completed' })
      }
    }
  }
}
