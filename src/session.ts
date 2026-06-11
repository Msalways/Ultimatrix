import { marked } from 'marked'
import TerminalRenderer from 'marked-terminal'
import { createSupervisor } from './manager/agent'
import { getBrowser, closeBrowser } from './browser/manager'
import { loadConfig } from './config'
import { readLine } from './utils/readline'
import { log } from './utils/logger'
import { startOastServer, stopOastServer } from './oast/server'
import { getGlobalOastStore } from './oast/store'
import { createRecorder, getGlobalRecorder, setGlobalRecorder } from './recorder/index'
import type { FindingNode } from './graph/schema'
import { getGlobalGraphStore } from './graph/store'
import { createSpiderAgent } from './spider/agent'
import { createAllWorkers } from './workers/registry'
import { setSharedWorkers } from './tools/delegate-tool'
import { dismissOverlays, exploreFormsOnPage, fillAndSubmitForm } from './explorer/spider-features'
import { getReusableAuthFlow, replayAuthFlow, detectLogoutFlow, detectTokenRefreshFlow, createAuthFlow } from './intelligence/auth-recorder'
import { emitSpiderProgress, emitActivityStart, emitActivityComplete } from './events/emitter'
import { checkForPreviousSession, resumeSession } from './intelligence/session-resume'
import { detectChains } from './intelligence/chaining'
import { chromium } from 'playwright'

marked.setOptions({
  renderer: new TerminalRenderer(),
})

export async function main(targetUrl?: string) {
  const config = loadConfig()
  const threadId = 'ultimatrix-' + Date.now()

  const sessionSummary = await checkForPreviousSession()
  if (sessionSummary.hasPreviousSession) {
    log.info(`Previous session found: ${sessionSummary.findingCount} findings, ${sessionSummary.pageCount} pages, ${sessionSummary.actionCount} actions`)
    await resumeSession(sessionSummary.lastSessionName)
  }

  if (targetUrl) {
    if (!getGlobalRecorder()) {
      createRecorder(targetUrl)
    }
  }

  const oastPort = await startOastServer()
  log.info(`OAST server started on port ${oastPort}`)
  await getGlobalOastStore().load()

  await getGlobalGraphStore().load()

  const browser = getBrowser()

  if (targetUrl) {
    try {
      log.info(`Starting spider crawl of ${targetUrl}...`)
      emitSpiderProgress(targetUrl, 0)

      const spiderAgent = createSpiderAgent(config.model as any, browser)
      const result = await spiderAgent.generate(
        `Use stagehandAct to navigate to ${targetUrl} and discover pages, forms, and endpoints. Record everything with updateGraph.`,
        { memory: { thread: threadId + '-spider', resource: 'ultimatrix-spider' } }
      )
      log.markdown(await marked.parse(result?.text || ''))

      let playwrightBrowser: any
      try {
        playwrightBrowser = await chromium.launch({ headless: config.headless })
        const context = await playwrightBrowser.newContext()
        const page = await context.newPage()
        await page.goto(targetUrl, { waitUntil: 'load', timeout: 30000 })

        const overlays = await dismissOverlays(page)
        if (overlays.length > 0) {
          log.info(`Dismissed ${overlays.length} overlay(s): ${[...new Set(overlays.map(o => o.includes('"') ? o.split('"')[1] || o : o))].slice(0, 5).join(', ')}`)
        }

        const pageContent = await page.content()
        const logoutFlow = detectLogoutFlow(pageContent)
        if (logoutFlow) {
          log.info(`Logout flow detected: selector="${logoutFlow.logoutSelector}"`)
          createAuthFlow('logout', [{ action: 'click', selector: logoutFlow.logoutSelector }])
        }

        const tokenRefresh = detectTokenRefreshFlow(pageContent)
        if (tokenRefresh) {
          log.info(`Token refresh likely at ${tokenRefresh.refreshUrl} (${tokenRefresh.likelyMethod})`)
          createAuthFlow('refresh', [{ action: 'api-call', url: tokenRefresh.refreshUrl }])
        }

        const existingAuthFlow = getReusableAuthFlow()
        if (existingAuthFlow) {
          log.info(`Found reusable auth flow (${existingAuthFlow.properties.flowType}), available for replay`)
        }

        const forms = await exploreFormsOnPage(page)
        if (forms.length > 0) {
          log.info(`Discovered ${forms.length} form(s) on the page`)
          for (const f of forms) {
            log.dim(`  Form action="${f.action}" method="${f.method}" with ${f.fields.length} field(s)`)
            const fieldValues: Record<string, string> = {}
            for (const field of f.fields) {
              if (field.type === 'email') fieldValues[field.name] = 'test@example.com'
              else if (field.type === 'password') fieldValues[field.name] = 'TestPass123!'
              else if (field.type === 'text') fieldValues[field.name] = 'test'
              else if (field.type === 'search') fieldValues[field.name] = 'xss'
              else if (field.type === 'tel') fieldValues[field.name] = '555-0100'
              else if (field.name.toLowerCase().includes('user')) fieldValues[field.name] = 'admin'
              else if (field.name.toLowerCase().includes('name')) fieldValues[field.name] = 'Test User'
              else fieldValues[field.name] = 'test'
            }
            if (Object.keys(fieldValues).length > 0) {
              const filled = await fillAndSubmitForm(page, f.selector, fieldValues)
              if (filled) log.info(`  → Auto-filled and submitted form "${f.action}"`)
            }
          }
        }

        emitSpiderProgress(targetUrl, 200)
        await page.close()
      } catch {
        log.warn('Could not run executable spider features (Playwright page required)')
      } finally {
        if (playwrightBrowser) await playwrightBrowser.close()
      }

      await getGlobalGraphStore().save()
    } catch (err) {
      log.error(err instanceof Error ? err.message : String(err))
    }
  }

  const recorder = getGlobalRecorder() || undefined

  emitActivityStart('spider', 'Creating specialist workers')
  const workers = await createAllWorkers(config.model as any, browser, recorder)
  setSharedWorkers(workers)
  emitActivityComplete('spider', 'All workers created')

  const supervisor = createSupervisor(config)

  log.banner('Ultimatrix Security Assistant v5', 'Model: ' + config.model + (targetUrl ? '  |  Target: ' + targetUrl : '') + `  |  OAST: :${oastPort}`)

  if (!targetUrl) {
    log.info('No target set. Tell me a URL to investigate.')
  }

  log.nl()
  log.dim('Entering interactive mode. Type your message or Ctrl+C to exit.')
  log.nl()

  try {
    for (;;) {
      let line: string
      try {
        line = await readLine()
      } catch {
        break
      }
      if (!line.trim()) continue

      try {
        const resp = await supervisor.generate(line, { memory: { thread: threadId, resource: 'ultimatrix' } })
        log.markdown(await marked.parse(resp?.text || ''))

        const store = getGlobalGraphStore()
        await store.save()
        await getGlobalOastStore().save()

        const allNodes = store.queryNodes()
        const findings = allNodes.filter(n => n.type === 'Finding') as FindingNode[]
        if (findings.length > 0) {
          const chains = detectChains(findings)
          for (const chain of chains) {
            log.info(`Chain detected: ${chain.rule.name} — ${chain.source.properties.technique} → ${chain.target.properties.technique} (${chain.rule.severity})`)
          }
        }
      } catch (err) {
        log.error(err instanceof Error ? err.message : String(err))
      }
      log.nl()
    }
  } finally {
    await getGlobalGraphStore().save()
    await getGlobalOastStore().save()
    await stopOastServer()
    await closeBrowser()
  }
}