import { createSupervisor } from './manager/agent'
import { getOrCreateBrowser, closeBrowser } from './browser/manager'
import { loadConfig } from './config'
import { log } from './utils/logger'
import { startOastServer, stopOastServer } from './oast/server'
import { getGlobalOastStore } from './oast/store'
import { getGlobalGraphStore } from './graph/store'
import { createAllWorkers, createMemoryStore, createMemory } from './workers/registry'
import { userInputEmitter } from './tools/interaction-tools'
import { detectChains } from './intelligence/chaining'
import type { FindingNode } from './graph/schema'
import { createSpiderAgent } from './spider/agent'
import { createInterface } from 'node:readline/promises'

const internalTools = new Set(['updateWorkingMemory', 'setWorkingMemory'])

export async function main(targetUrl?: string) {
  const config = loadConfig()
  if (targetUrl) config.target = targetUrl
  const threadId = 'ultimatrix-' + Date.now()
  const resourceId = 'ultimatrix'

  const store = await createMemoryStore()
  const memory = await createMemory(config, store)
  await getGlobalGraphStore().load()
  await getGlobalOastStore().load()

  const browser = getOrCreateBrowser(config)
  await browser.ensureReady()

  const oastPort = await startOastServer()
  log.info(`OAST server started on port ${oastPort}`)

  const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: false })

  function getLine(): Promise<string | null> {
    return new Promise(resolve => {
      rl.once('line', line => resolve(line))
      rl.once('close', () => resolve(null))
    })
  }

  userInputEmitter.on('askUser-question', (question: string) => {
    process.stdout.write('\n' + question + ' ')
    rl.once('line', (answer: string) => {
      userInputEmitter.emit('askUser-response', answer)
    })
  })

  async function consumeStream(stream: AsyncIterable<any>) {
    let reasoningBuf: string[] = []
    let reasoningTimer: ReturnType<typeof setTimeout> | null = null

    const flushReasoning = () => {
      if (reasoningTimer) clearTimeout(reasoningTimer)
      reasoningTimer = null
      if (reasoningBuf.length > 0) {
        const text = reasoningBuf.join('')
        log.dim(text)
        reasoningBuf = []
      }
    }

    const scheduleReasoning = () => {
      if (reasoningTimer) clearTimeout(reasoningTimer)
      reasoningTimer = setTimeout(flushReasoning, 150)
    }

    for await (const chunk of stream) {
      switch (chunk.type) {
        case 'text-delta':
          flushReasoning()
          process.stdout.write(chunk.payload.text)
          break
        case 'reasoning-delta':
          reasoningBuf.push(chunk.payload.text)
          scheduleReasoning()
          break
        case 'reasoning-end':
          flushReasoning()
          break
        case 'tool-call':
          if (chunk.payload.toolName === 'askUser') break
          if (internalTools.has(chunk.payload.toolName)) break
          flushReasoning()
          log.dim(chunk.payload.toolName + '...')
          break
        case 'tool-result':
          if (internalTools.has(chunk.payload.toolName)) break
          flushReasoning()
          log.success(chunk.payload.toolName)
          break
        case 'tool-error':
          flushReasoning()
          log.error(chunk.payload.toolName + ': ' + chunk.payload.error)
          break
        case 'error':
          flushReasoning()
          log.error(String(chunk.payload.error))
          break
        case 'step-finish':
          await getGlobalGraphStore().save()
          break
        case 'background-task-started':
          flushReasoning()
          log.dim('background task: ' + chunk.payload.toolName + '...')
          break
        case 'background-task-completed':
          flushReasoning()
          log.success('background task: ' + chunk.payload.toolName)
          break
        case 'background-task-failed':
          flushReasoning()
          log.error('background task: ' + chunk.payload.toolName)
          break
      }
    }
    flushReasoning()
  }

  if (targetUrl) {
    try {
      log.info('Crawling ' + targetUrl + '...')
      const spiderAgent = createSpiderAgent(config, memory, browser)
      const result = await spiderAgent.stream(
        `Navigate to ${targetUrl} using stagehand_navigate. Use stagehand tools to dismiss overlays, discover forms/fill them, detect auth flows (login/logout/login/logout/refresh), and record everything with updateGraph. Report all findings.`,
        { memory: { thread: threadId + '-spider', resource: resourceId + '-spider' }, toolChoice: 'required' },
      )
      await consumeStream(result.fullStream)
      await getGlobalGraphStore().save()
    } catch (err) {
      log.error(err instanceof Error ? err.message : String(err))
    }
  }

  const workers = await createAllWorkers(config, browser, memory)
  const supervisor = createSupervisor(config, { workers, browser, memory })

  log.banner('Ultimatrix Security Assistant v5',
    'Model: ' + config.model + (targetUrl ? '  |  Target: ' + targetUrl : '') + `  |  OAST: :${oastPort}`)

  if (!targetUrl) {
    log.info('No target set. Tell me a URL to investigate.')
  }

  log.nl()
  log.dim('Entering interactive mode. Type your message or Ctrl+C to exit.')
  log.nl()

  try {
    for (;;) {
      process.stdout.write('> ')
      const line = await getLine()
      if (line === null) break
      if (!line.trim()) continue

      try {
        process.stdout.write('\n')
        const result = await supervisor.stream(line, {
          memory: { thread: threadId, resource: resourceId },
          maxSteps: config.agent.maxSteps,
        })
        await consumeStream(result.fullStream)
        process.stdout.write('\n')

        const graph = getGlobalGraphStore()
        const allNodes = graph.queryNodes()
        const findings = allNodes.filter(n => n.type === 'Finding') as FindingNode[]
        if (findings.length > 0) {
          const chains = detectChains(findings)
          for (const chain of chains) {
            log.info('Chain detected: ' + chain.rule.name + ' — ' + chain.source.properties.technique + ' → ' + chain.target.properties.technique + ' (' + chain.rule.severity + ')')
          }
        }

        await getGlobalGraphStore().save()
        await getGlobalOastStore().save()
      } catch (err) {
        process.stdout.write('\n')
        log.error(err instanceof Error ? err.message : String(err))
      }
      process.stdout.write('\n')
    }
  } finally {
    await getGlobalGraphStore().save()
    await getGlobalOastStore().save()
    await stopOastServer()
    await closeBrowser()
    rl.close()
  }
}
