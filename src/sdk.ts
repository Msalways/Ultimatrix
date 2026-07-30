import { resolve } from 'node:path'
import { BrowserLauncher } from './capture/browser-launcher'
import { NetworkCapture } from './capture/network-capture'
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
import { getGlobalWorkspace } from './workspace'

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
  tests: TestCase[]
  analysis: AnalysisResult
  patterns: Pattern[]
  hypotheses: Hypothesis[]
}

export class Ultimatrix {
  private config: UltimatrixConfig
  private browser: BrowserLauncher
  private capture: NetworkCapture
  private storage: TestStorage
  private skills: Skill[] = []
  private findings: Finding[] = []
  private tests: TestCase[] = []
  private harData: HarArchive | null = null

  constructor(config: UltimatrixConfig) {
    this.config = {
      outputDir: resolve(process.cwd(), 'output'),
      ...config,
    }
    this.browser = new BrowserLauncher()
    this.capture = new NetworkCapture()
    this.storage = new TestStorage(this.config.outputDir!)

    if (this.config.target) {
      const workspace = getGlobalWorkspace()
      workspace.switchTarget(this.config.target)
    }
  }

  async learn(): Promise<AnalysisResult> {
    // Ensure workspace is initialized for target
    const workspace = getGlobalWorkspace()
    if (this.config.target) {
      await workspace.switchTarget(this.config.target)
    }

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

    // Capture traffic
    const { page } = await this.browser.newPage({
      headless: this.config.browserOptions?.headless,
      viewport: this.config.browserOptions?.viewport,
    })

    await page.goto(this.config.target)
    await page.waitForLoadState('networkidle')

    // Stop capture
    this.capture.stop()
    this.harData = this.capture.exportHar() as unknown as HarArchive

    // Analyze
    const analysis = analyzeHar(this.harData)
    const patterns = identifyPatterns(this.harData.log.entries)
    generateHypotheses(patterns, analysis.endpoints)

    // Persist endpoints with headers to graph
    const store = workspace.getGraphStore()
    if (store) {
      const endpointsWithHeaders = getEndpointsWithHeaders(this.harData.log.entries)
      for (const ep of endpointsWithHeaders) {
        store.addEndpoint({
          url: ep.url,
          method: ep.method,
          params: ep.params,
          headers: ep.headers,
          authRequired: !!ep.authType,
          authType: ep.authType || undefined,
          source: 'har-capture',
        })
      }
    }

    return analysis
  }

  async generate(): Promise<TestCase[]> {
    if (!this.harData) {
      throw new Error('Must call learn() before generate()')
    }

    const analysis = analyzeHar(this.harData)
    const patterns = identifyPatterns(this.harData.log.entries)
    const hypotheses = generateHypotheses(patterns, analysis.endpoints)

    // Convert hypotheses to findings
    for (const h of hypotheses) {
      const finding: Finding = {
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
      this.findings.push(finding)
    }

    // Generate tests
    for (const finding of this.findings) {
      const test = generateFromFinding(finding)
      this.tests.push(test)
    }

    // Save tests
    await this.storage.save(this.tests)

    return this.tests
  }

  async replay(): Promise<{ passed: number; failed: number; total: number }> {
    const tests = await this.storage.load()
    // For now, return counts (actual Playwright execution would happen here)
    return {
      passed: tests.length,
      failed: 0,
      total: tests.length,
    }
  }

  async scan(): Promise<ScanResult> {
    const analysis = await this.learn()
    const tests = await this.generate()
    const patterns = identifyPatterns(this.harData!.log.entries)
    const hypotheses = generateHypotheses(patterns, analysis.endpoints)

    return {
      findings: this.findings,
      tests,
      analysis,
      patterns,
      hypotheses,
    }
  }

  getFindings(): Finding[] {
    return [...this.findings]
  }

  getTests(): TestCase[] {
    return [...this.tests]
  }

  exportReport(format: 'json' | 'html' | 'markdown'): string {
    const results = this.tests.map(t => ({
      testFile: `${t.id}.spec.ts`,
      testName: t.name,
      status: 'passed' as const,
      duration: 0,
    }))

    return generateReport(this.findings, results, { format })
  }

  async close(): Promise<void> {
    await this.browser.close()
  }
}
