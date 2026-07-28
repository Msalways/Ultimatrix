import { exec } from 'node:child_process'
import { promisify } from 'node:util'
import { readdir } from 'node:fs/promises'
import { join } from 'node:path'

const execAsync = promisify(exec)

export interface TestResult {
  testFile: string
  testName: string
  status: 'passed' | 'failed' | 'skipped' | 'error'
  duration: number
  error?: string
  stdout?: string
  stderr?: string
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
      const { stdout, stderr } = await execAsync(
        `npx playwright test "${testFile}" --reporter=json`,
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
        status: parsed.status || 'passed',
        duration,
        stdout,
        stderr,
      }
    } catch (error: any) {
      const duration = Date.now() - startTime
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
      const { stdout } = await execAsync(
        `npx playwright test "${testDir}" --reporter=json`,
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
      const lines = stdout.split('\n')
      for (const line of lines) {
        if (line.startsWith('{') && line.includes('"stats"')) {
          return JSON.parse(line)
        }
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
