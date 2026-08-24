import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { readdir } from 'node:fs/promises'
import { join } from 'node:path'

const execFileAsync = promisify(execFile)
const npx = process.platform === 'win32' ? 'npx.cmd' : 'npx'

export interface TestResult {
  testFile: string
  testName: string
  status: 'passed' | 'failed' | 'skipped' | 'error' | 'not-run'
  duration: number
  error?: string
  stdout?: string
  stderr?: string
  executed?: boolean
}

export interface RunResults {
  total: number
  passed: number
  failed: number
  skipped: number
  errors: number
  duration: number
  results: TestResult[]
}

export interface RunAllOptions {
  concurrency?: number
  timeout?: number
}

export class TestRunner {
  private projectDir: string

  constructor(projectDir: string) {
    this.projectDir = projectDir
  }

  async run(testFile: string): Promise<TestResult> {
    const startTime = Date.now()

    try {
      const { stdout, stderr } = await execFileAsync(
        npx,
        ['playwright', 'test', testFile, '--reporter=json'],
        {
          cwd: this.projectDir,
          timeout: 60000,
          env: { ...process.env, CI: 'true' },
        }
      )

      const duration = Date.now() - startTime
      const parsed = this.parsePlaywrightOutput(stdout)

      return {
        testFile,
        testName: parsed.name || testFile,
        status: parsed.status || 'not-run',
        duration,
        stdout,
        stderr,
      }
    } catch (error: any) {
      const duration = Date.now() - startTime
      const parsed = this.parsePlaywrightOutput(error.stdout ?? '')
      if (parsed.status && parsed.status !== 'not-run') {
        return {
          testFile,
          testName: parsed.name || testFile,
          status: parsed.status,
          duration,
          stdout: error.stdout,
          stderr: error.stderr,
          executed: true,
        }
      }
      return {
        testFile,
        testName: testFile,
        status: 'error',
        duration,
        error: error.message,
        stdout: error.stdout,
        stderr: error.stderr,
      }
    }
  }

  async runAll(testDir: string, options: RunAllOptions = {}): Promise<RunResults> {
    const { concurrency = 1, timeout = 120000 } = options

    if (concurrency <= 1) {
      return this.runAllSequential(testDir, timeout)
    }

    return this.runAllParallel(testDir, concurrency, timeout)
  }

  private async runAllSequential(testDir: string, timeout: number): Promise<RunResults> {
    const startTime = Date.now()

    try {
      const { stdout } = await execFileAsync(
        npx,
        ['playwright', 'test', testDir, '--reporter=json'],
        {
          cwd: this.projectDir,
          timeout,
          env: { ...process.env, CI: 'true' },
        }
      )

      const duration = Date.now() - startTime
      const parsed = this.parsePlaywrightOutput(stdout)

      return {
        total: parsed.total || 0,
        passed: parsed.passed || 0,
        failed: parsed.failed || 0,
        skipped: parsed.skipped || 0,
        errors: parsed.errors || 0,
        duration,
        results: parsed.results || [],
      }
    } catch (error: any) {
      const duration = Date.now() - startTime
      const parsed = this.parsePlaywrightOutput(error.stdout ?? '')
      if (parsed.total > 0) {
        return {
          total: parsed.total,
          passed: parsed.passed,
          failed: parsed.failed,
          skipped: parsed.skipped,
          errors: parsed.errors,
          duration,
          results: parsed.results ?? [],
        }
      }
      return {
        total: 0,
        passed: 0,
        failed: 0,
        skipped: 0,
        errors: 1,
        duration,
        results: [{
          testFile: testDir,
          testName: testDir,
          status: 'error',
          duration,
          error: error.message,
        }],
      }
    }
  }

  private async runAllParallel(testDir: string, concurrency: number, _timeout: number): Promise<RunResults> {
    const startTime = Date.now()
    const allResults: TestResult[] = []

    let files: string[]
    try {
      const entries = await readdir(testDir)
      files = entries.filter(f => f.endsWith('.spec.ts')).map(f => join(testDir, f))
    } catch {
      return {
        total: 0, passed: 0, failed: 0, skipped: 0, errors: 1,
        duration: Date.now() - startTime,
        results: [{ testFile: testDir, testName: testDir, status: 'error', duration: Date.now() - startTime, error: 'Failed to read test directory' }],
      }
    }

    if (files.length === 0) {
      return {
        total: 0, passed: 0, failed: 0, skipped: 0, errors: 0,
        duration: Date.now() - startTime,
        results: [],
      }
    }

    const queue = [...files]
    const running: Promise<void>[] = []

    const runNext = async (): Promise<void> => {
      while (queue.length > 0) {
        const file = queue.shift()!
        const result = await this.run(file)
        allResults.push(result)
      }
    }

    for (let i = 0; i < Math.min(concurrency, files.length); i++) {
      running.push(runNext())
    }

    await Promise.all(running)

    const duration = Date.now() - startTime
    const passed = allResults.filter(r => r.status === 'passed').length
    const failed = allResults.filter(r => r.status === 'failed').length
    const skipped = allResults.filter(r => r.status === 'skipped').length
    const errors = allResults.filter(r => r.status === 'error').length

    return {
      total: allResults.length,
      passed,
      failed,
      skipped,
      errors,
      duration,
      results: allResults,
    }
  }

  private parsePlaywrightOutput(stdout: string): any {
    try {
      const start = stdout.indexOf('{')
      const end = stdout.lastIndexOf('}')
      if (start === -1 || end < start) throw new Error('missing JSON report')
      const report = JSON.parse(stdout.slice(start, end + 1))
      const stats = report.stats ?? {}
      const passed = Number(stats.expected ?? 0)
      const failed = Number(stats.unexpected ?? 0)
      const skipped = Number(stats.skipped ?? 0)
      const errors = Array.isArray(report.errors) ? report.errors.length : 0
      const total = passed + failed + skipped + Number(stats.flaky ?? 0)
      return {
        total,
        passed,
        failed,
        skipped,
        errors,
        status: failed > 0 ? 'failed' : passed > 0 ? 'passed' : skipped > 0 ? 'skipped' : errors > 0 ? 'error' : 'not-run',
        name: report.suites?.[0]?.specs?.[0]?.title,
        results: [],
      }
    } catch {
      // Fall back to basic parsing
    }

    return {
      total: 0,
      passed: 0,
      failed: 0,
      skipped: 0,
      errors: 0,
    }
  }
}
