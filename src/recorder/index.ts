import { randomUUID } from 'node:crypto'
import { writeFile, readFile, mkdir, access } from 'node:fs/promises'
import { resolve, join } from 'node:path'
import { existsSync } from 'node:fs'
import {
  Interaction,
  InteractionType,
  Assertion,
  TestCase,
  Session,
} from './interaction'
import { generateTestCases } from './test-generator'
import { streamToFile, generateSpecCode } from './codegen'

export class ActionRecorder {
  private session: Session
  private outputDir: string
  private specFilePath: string
  private testCaseBuffer: TestCase[] = []

  constructor(targetUrl: string, sessionName?: string) {
    const sessionId = `session-${Date.now()}-${randomUUID().slice(0, 8)}`
    const name = sessionName || `recording-${Date.now()}`
    this.session = {
      id: sessionId,
      name,
      targetUrl,
      startedAt: Date.now(),
      interactions: [],
      testCases: [],
    }
    this.outputDir = resolve('output', 'recordings')
    this.specFilePath = join(this.outputDir, `${name}.spec.ts`)
    this.ensureOutputDir()
  }

  private ensureOutputDir(): void {
    if (!existsSync(this.outputDir)) {
      mkdir(this.outputDir, { recursive: true }).catch(() => {})
    }
  }

  record(
    type: InteractionType,
    description: string,
    options: {
      url?: string
      selector?: string
      value?: string
      naturalLanguage?: string
      parentId?: string
      metadata?: Record<string, unknown>
    } = {}
  ): string {
    const interaction: Interaction = {
      id: randomUUID(),
      type,
      timestamp: Date.now(),
      sessionId: this.session.id,
      description,
      url: options.url,
      selector: options.selector,
      value: options.value,
      naturalLanguage: options.naturalLanguage,
      parentId: options.parentId,
      metadata: options.metadata,
    }

    this.session.interactions.push(interaction)

    const testCases = generateTestCases(interaction)
    if (testCases.length > 0) {
      this.testCaseBuffer.push(...testCases)
      this.session.testCases.push(...testCases)
      this.streamTestCases(testCases)
    }

    return interaction.id
  }

  private async streamTestCases(testCases: TestCase[]): Promise<void> {
    try {
      await streamToFile(this.specFilePath, testCases)
    } catch {
      // Non-blocking - recording continues even if streaming fails
    }
  }

  query(filter: {
    type?: InteractionType
    url?: string
    since?: number
    parentId?: string
    limit?: number
  } = {}): Interaction[] {
    let result = this.session.interactions

    if (filter.type) result = result.filter(i => i.type === filter.type)
    if (filter.url) result = result.filter(i => i.url?.includes(filter.url!))
    if (filter.since) result = result.filter(i => i.timestamp >= filter.since!)
    if (filter.parentId) result = result.filter(i => i.parentId === filter.parentId)

    if (filter.limit) result = result.slice(-filter.limit)

    return result
  }

  getInteractions(): Interaction[] {
    return this.session.interactions
  }

  getTestCases(): TestCase[] {
    return this.session.testCases
  }

  getSession(): Session {
    return this.session
  }

  async save(): Promise<void> {
    const sessionPath = join(this.outputDir, `${this.session.name}.json`)
    await writeFile(sessionPath, JSON.stringify(this.session, null, 2), 'utf-8')
  }

  static async load(sessionName: string): Promise<ActionRecorder | null> {
    const sessionPath = resolve('output', 'recordings', `${sessionName}.json`)
    if (!existsSync(sessionPath)) return null

    try {
      const raw = await readFile(sessionPath, 'utf-8')
      const session = JSON.parse(raw) as Session
      const recorder = new ActionRecorder(session.targetUrl, session.name)
      recorder.session = session
      return recorder
    } catch {
      return null
    }
  }
}

let _globalRecorder: ActionRecorder | null = null

export function getGlobalRecorder(): ActionRecorder | null {
  return _globalRecorder
}

export function setGlobalRecorder(recorder: ActionRecorder | null): void {
  _globalRecorder = recorder
}

export function createRecorder(targetUrl: string, sessionName?: string): ActionRecorder {
  const recorder = new ActionRecorder(targetUrl, sessionName)
  setGlobalRecorder(recorder)
  return recorder
}