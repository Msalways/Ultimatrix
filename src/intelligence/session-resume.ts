import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import {readdir} from 'node:fs/promises'
import { getGlobalGraphStore } from '../graph/store'

export interface SessionSummary {
  hasPreviousSession: boolean
  findingCount: number
  pageCount: number
  actionCount: number
  testCount: number
  lastSessionName?: string
  recordings: string[]
}

export async function checkForPreviousSession(): Promise<SessionSummary> {
  const graphPath = resolve('output', 'graph.json')
  const recordingsDir = resolve('output', 'recordings')

  const hasGraph = existsSync(graphPath)
  const hasRecordings = existsSync(recordingsDir)

  let recordings: string[] = []
  if (hasRecordings) {
    try {
      const files = await readdir(recordingsDir)
      recordings = files.filter(f => f.endsWith('.json')).map(f => f.replace('.json', ''))
    } catch {
      // ignore
    }
  }

  if (hasGraph) {
    const store = getGlobalGraphStore()
    await store.load()
    const allNodes = store.queryNodes()
    const findings = allNodes.filter(n => n.type === 'Finding')
    const pages = allNodes.filter(n => n.type === 'Page')
    const actions = allNodes.filter(n => n.type === 'Action')
    const tests = allNodes.filter(n => n.type === 'Test')

    return {
      hasPreviousSession: true,
      findingCount: findings.length,
      pageCount: pages.length,
      actionCount: actions.length,
      testCount: tests.length,
      lastSessionName: recordings[recordings.length - 1],
      recordings,
    }
  }

  return {
    hasPreviousSession: false,
    findingCount: 0,
    pageCount: 0,
    actionCount: 0,
    testCount: 0,
    recordings,
  }
}

export async function resumeSession(sessionName?: string): Promise<boolean> {
  const { ActionRecorder } = await import('../recorder/index')

  if (sessionName) {
    const recorder = await ActionRecorder.load(sessionName)
    if (recorder) {
      const { setGlobalRecorder } = await import('../recorder/index')
      setGlobalRecorder(recorder)
      return true
    }
  }

  return false
}