import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { WebEngine } from '../../src/web/engine'
import { InteractionType, type TestCase } from '../../src/recorder/interaction'

describe('WebEngine code ownership', () => {
  it('generates code from its runtime-owned recorder', () => {
    const testCase: TestCase = {
      id: 'tc-owned',
      name: 'owned recording',
      type: 'happy',
      description: 'runtime-owned recording',
      interactions: [{
        id: 'interaction-owned',
        type: InteractionType.GOTO,
        timestamp: 1,
        sessionId: 'session-owned',
        description: 'open target',
        url: 'https://owned.example',
      }],
      assertions: [],
      tags: [],
    }
    const engine = new WebEngine('https://owned.example')
    ;(engine as any).runtime = { services: { recorder: { getTestCases: () => [testCase] } } }

    expect(engine.getCode().join('\n')).toContain("page.goto('https://owned.example')")
  })

  it('keeps the code API target-addressed and free of AgentManager singleton access', async () => {
    const source = await readFile(join(process.cwd(), 'src/app/api/code/route.ts'), 'utf8')

    expect(source).toContain("searchParams.get('target')")
    expect(source).toContain('targetManager.getEngine(target)')
    expect(source).not.toContain('AgentManager')
    expect(source).not.toContain('getInstance()')
  })

  it('keeps browser and status APIs target-addressed', async () => {
    const [browserRoute, statusRoute] = await Promise.all([
      readFile(join(process.cwd(), 'src/app/api/browser/route.ts'), 'utf8'),
      readFile(join(process.cwd(), 'src/app/api/status/route.ts'), 'utf8'),
    ])

    for (const source of [browserRoute, statusRoute]) {
      expect(source).toContain("searchParams.get('target')")
      expect(source).not.toContain("from '@/browser/manager'")
    }
    expect(browserRoute).toContain('engine.getBrowserState()')
    expect(statusRoute).toContain('getBrowserState()')
  })
})
