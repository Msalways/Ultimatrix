import { createTool } from '@mastra/core/tools'
import { z } from 'zod'
import { getGlobalGraphStore } from '../graph/store'
import { NodeType, type AuthFlowNode, type FactNode, type ActionNode } from '../graph/schema'
import { getGlobalWorkspace } from '../workspace'
import { getGlobalObserver, type HumanAction } from '../capture/human-observer'
import { getActiveBrowser, getActivePage, captureScreenshot } from '../browser/manager'
import { log } from '../utils/logger'
import { createHash } from 'node:crypto'
import { isUrlInScope } from '../safety/scope-guard'

function hashCredential(value: string): string {
  return createHash('sha256').update(value).digest('hex').slice(0, 16)
}

const LOGIN_URL_PATTERNS = [
  /\/login/i, /\/signin/i, /\/auth/i, /\/sso/i,
  /\/session\/new/i, /\/account\/login/i,
]

function isCookieExpired(cookie: any): boolean {
  if (!cookie.expires || cookie.expires === -1) return false
  return cookie.expires < Math.floor(Date.now() / 1000)
}

function filterValidCookies(cookies: any[]): { valid: any[]; expired: number } {
  const valid: any[] = []
  let expired = 0
  for (const c of cookies) {
    if (isCookieExpired(c)) {
      expired++
    } else {
      valid.push(c)
    }
  }
  return { valid, expired }
}

async function verifySessionAfterRestore(page: any, targetUrl: string): Promise<{ authenticated: boolean; reason?: string }> {
  try {
    const finalUrl = page.url()
    const isLoginPage = LOGIN_URL_PATTERNS.some(p => p.test(finalUrl))
    if (isLoginPage) {
      return { authenticated: false, reason: `Redirected to login page: ${finalUrl}` }
    }
    const hasLoginForm = await page.$('input[type="password"]').catch(() => null)
    if (hasLoginForm) {
      return { authenticated: false, reason: 'Page contains a login form — session may be expired' }
    }
    return { authenticated: true }
  } catch {
    return { authenticated: true }
  }
}

export const saveSession = createTool({
  id: 'saveSession',
  description: 'Save the current browser session (cookies, localStorage) to the knowledge graph for reuse across sessions.',
  inputSchema: z.object({
    name: z.string().describe('A memorable name for this session (e.g. "admin-login", "api-token")'),
    description: z.string().optional().describe('What this session provides access to'),
    flowSteps: z.array(z.object({
      action: z.string(),
      url: z.string().optional(),
      selector: z.string().optional(),
      value: z.string().optional(),
    })).optional().describe('Optional flow steps that led to this session'),
  }),
  execute: async ({ name, description, flowSteps }) => {
    const store = getGlobalGraphStore()
    const workspace = getGlobalWorkspace()
    const target = workspace.getCurrentTarget()

    const browser = getActiveBrowser()
    if (!browser) return { ok: false, error: 'No browser available' }

    const stagehand = (browser as any).requireStagehand?.()
    if (!stagehand?.context) return { ok: false, error: 'Stagehand context not available' }

    const cookies = await stagehand.context.cookies().catch(() => [])

    const page = getActivePage()
    let localStorage: Record<string, string> = {}
    if (page) {
      try {
        localStorage = await page.evaluate(() => {
          const items: Record<string, string> = {}
          for (let i = 0; i < window.localStorage.length; i++) {
            const k = window.localStorage.key(i)
            if (k) items[k] = window.localStorage.getItem(k) || ''
          }
          return items
        })
      } catch {}
    }

    const authFlow = store.addAuthFlow({
      flowType: 'login',
      steps: flowSteps || [],
      reusable: true,
      credentialHash: hashCredential(JSON.stringify(cookies)),
      name,
      description: description || `Session: ${name}`,
      cookies: Array.isArray(cookies) ? cookies.map((c: any) => ({
        name: c.name,
        value: c.value,
        domain: c.domain,
        path: c.path,
        httpOnly: c.httpOnly,
        secure: c.secure,
        sameSite: c.sameSite,
        expires: c.expires,
      })) : [],
      localStorage,
      target: target || '',
      savedAt: new Date().toISOString(),
    })

    store.addFact({
      description: `Session "${name}" saved for ${target || 'unknown target'}. Use the saved session to continue testing.`,
      source: 'human-demonstration',
      confidence: 1.0,
    })

    store.save().catch(err => log.error('Graph save failed: ' + String(err)))

    return {
      ok: true,
      value: {
        flowId: authFlow.id,
        name,
        cookieCount: Array.isArray(cookies) ? cookies.length : 0,
        localStorageKeys: Object.keys(localStorage).length,
      },
    }
  },
})

export const restoreSession = createTool({
  id: 'restoreSession',
  description: 'Restore a previously saved browser session by setting cookies and localStorage on the current page.',
  inputSchema: z.object({
    name: z.string().describe('Session name to restore'),
  }),
  execute: async ({ name }) => {
    const store = getGlobalGraphStore()
    const workspace = getGlobalWorkspace()
    const target = workspace.getCurrentTarget()

    const flows = store.queryNodes(NodeType.AUTH_FLOW) as AuthFlowNode[]
    const flow = flows.find(f =>
      f.properties.name === name &&
      (!target || f.properties.target === target)
    )

    if (!flow) {
      return { ok: false, error: `Session "${name}" not found for this target` }
    }

    const browser = getActiveBrowser()
    if (!browser) return { ok: false, error: 'No browser available' }

    const stagehand = (browser as any).requireStagehand?.()
    if (!stagehand?.context) return { ok: false, error: 'Stagehand context not available' }

    const allCookies = flow.properties.cookies as any[] || []
    const { valid: cookies, expired: expiredCount } = filterValidCookies(allCookies)

    if (cookies.length === 0 && allCookies.length > 0) {
      return {
        ok: false,
        error: `Session "${name}" has ${expiredCount} expired cookies and no valid ones. The user must re-login.`,
        sessionExpired: true,
        savedAt: flow.properties.savedAt,
      }
    }

    if (cookies.length > 0) {
      await stagehand.context.addCookies(cookies.map((c: any) => ({
        name: c.name,
        value: c.value,
        domain: c.domain,
        path: c.path || '/',
        httpOnly: c.httpOnly || false,
        secure: c.secure || false,
        sameSite: (c.sameSite as 'Lax' | 'Strict' | 'None') || 'Lax',
        expires: c.expires || Math.floor(Date.now() / 1000) + 86400,
      })))
    }

    const localStorage = flow.properties.localStorage as Record<string, string> || {}
    const page = getActivePage()
    if (page && Object.keys(localStorage).length > 0) {
      for (const [key, value] of Object.entries(localStorage)) {
        await page.evaluate((k: string, v: string) => localStorage.setItem(k, v), key, value).catch(() => {})
      }
    }

    const sessionCheck = page ? await verifySessionAfterRestore(page, '') : { authenticated: true }

    log.dim(`🔑 Session "${name}" restored: ${cookies.length} cookies, ${Object.keys(localStorage).length} localStorage items${expiredCount > 0 ? ` (${expiredCount} expired, skipped)` : ''}`)

    return {
      ok: true,
      value: {
        name,
        cookieCount: cookies.length,
        expiredSkipped: expiredCount,
        localStorageKeys: Object.keys(localStorage).length,
        savedAt: flow.properties.savedAt,
        sessionValid: sessionCheck.authenticated,
        sessionWarning: sessionCheck.reason,
      },
    }
  },
})

export const observeHumanActions = createTool({
  id: 'observeHumanActions',
  description: 'Read human actions captured from the browser. Shows what the user did when interacting with the site.',
  inputSchema: z.object({
    sinceSeconds: z.number().optional().describe('Only return actions from the last N seconds. Default: all.'),
    flowOnly: z.boolean().optional().describe('If true, return grouped flow actions instead of raw actions'),
  }),
  execute: async ({ sinceSeconds, flowOnly }) => {
    const observer = getGlobalObserver()

    if (flowOnly) {
      const flows = observer.getFlowGroups()
      if (flows.length === 0) {
        return {
          ok: false,
          error: 'No human action flows recorded yet. The user has not performed any complete action sequences.',
        }
      }
      return {
        ok: true,
        value: {
          flowCount: flows.length,
          flows: flows.map(f => ({
            type: f.type,
            actionCount: f.actions.length,
            startUrl: f.startUrl,
            endUrl: f.endUrl,
            duration: f.duration,
            actions: f.actions.map(a => ({
              type: a.type,
              selector: a.selector,
              value: a.value,
              url: a.url,
            })),
          })),
        },
      }
    }

    const sinceMs = sinceSeconds ? sinceSeconds * 1000 : undefined
    const actions = sinceMs ? observer.getRecentActions(sinceMs) : observer.getActions()

    if (actions.length === 0) {
      return {
        ok: false,
        error: 'No human actions recorded yet. The user has not interacted with the browser.',
      }
    }

    return {
      ok: true,
      value: {
        actionCount: actions.length,
        actions: actions.map(a => ({
          type: a.type,
          selector: a.selector,
          value: a.value,
          url: a.url,
          timestamp: a.timestamp,
        })),
      },
    }
  },
})

export const saveLearnedFlow = createTool({
  id: 'saveLearnedFlow',
  description: 'Save a learned action flow (from human demonstration) to the knowledge graph for future reproduction.',
  inputSchema: z.object({
    name: z.string().describe('Name for this flow (e.g. "login-flow", "checkout-step-2")'),
    flowType: z.enum(['login', 'form-fill', 'navigation', 'custom']).describe('Type of flow'),
    actions: z.array(z.object({
      type: z.string(),
      selector: z.string().optional(),
      value: z.string().optional(),
      url: z.string().optional(),
    })).describe('Actions in this flow'),
    startUrl: z.string().optional(),
    endUrl: z.string().optional(),
  }),
  execute: async ({ name, flowType, actions, startUrl, endUrl }) => {
    const store = getGlobalGraphStore()
    const workspace = getGlobalWorkspace()
    const target = workspace.getCurrentTarget()

    const actionNodes: ActionNode[] = []
    // Create a placeholder page for the actions
    const pageUrl = startUrl || endUrl || 'unknown-page'
    const page = store.upsertPage(pageUrl)
    
    for (const action of actions) {
      const node = store.addAction(page.id, {
        actionType: action.type,
        selector: action.selector,
        value: action.value,
        url: action.url,
        naturalLanguage: `${action.type}${action.selector ? ` on ${action.selector}` : ''}${action.value ? ` with value "${action.value}"` : ''}`,
      })
      actionNodes.push(node)
    }

    const authFlow = store.addAuthFlow({
      flowType,
      steps: actions.map(a => ({
        action: a.type,
        url: a.url,
        selector: a.selector,
        value: a.value,
      })),
      reusable: true,
      name,
      description: `Learned ${flowType} flow: ${name}`,
      target: target || '',
      savedAt: new Date().toISOString(),
      actionNodeIds: actionNodes.map(n => n.id),
    })

    store.save().catch(err => log.error('Graph save failed: ' + String(err)))

    return {
      ok: true,
      value: {
        flowId: authFlow.id,
        name,
        flowType,
        actionCount: actions.length,
      },
    }
  },
})

export const reproduceFlow = createTool({
  id: 'reproduceFlow',
  description: 'Reproduce a saved action flow in the browser. For login flows, uses stored session cookies instead of replaying forms.',
  inputSchema: z.object({
    flowName: z.string().describe('Name of the flow to reproduce'),
  }),
  execute: async ({ flowName }) => {
    const store = getGlobalGraphStore()
    const workspace = getGlobalWorkspace()
    const target = workspace.getCurrentTarget()

    const flows = store.queryNodes(NodeType.AUTH_FLOW) as AuthFlowNode[]
    const flow = flows.find(f =>
      f.properties.name === flowName &&
      (!target || f.properties.target === target)
    )

    if (!flow) {
      return { ok: false, error: `Flow "${flowName}" not found` }
    }

    const page = getActivePage()
    if (!page) return { ok: false, error: 'No browser page available' }

    if (flow.properties.flowType === 'login' && flow.properties.cookies) {
      const browser = getActiveBrowser()
      if (browser) {
        const stagehand = (browser as any).requireStagehand?.()
        if (stagehand?.context) {
          const allCookies = flow.properties.cookies as any[]
          const { valid: cookies, expired: expiredCount } = filterValidCookies(allCookies)

          if (cookies.length === 0) {
            return {
              ok: false,
              error: `Flow "${flowName}" session has ${expiredCount} expired cookies. The user must re-login.`,
              sessionExpired: true,
            }
          }

          await stagehand.context.addCookies(cookies.map((c: any) => ({
            name: c.name,
            value: c.value,
            domain: c.domain,
            path: c.path || '/',
            httpOnly: c.httpOnly || false,
            secure: c.secure || false,
            sameSite: (c.sameSite as 'Lax' | 'Strict' | 'None') || 'Lax',
            expires: c.expires || Math.floor(Date.now() / 1000) + 86400,
          })))

          const firstStep = (flow.properties.steps as any[])?.[0]
          if (firstStep?.url) {
            const scopeCheck = isUrlInScope(firstStep.url)
            if (!scopeCheck.allowed) {
              return { ok: false, error: `Scope violation: ${scopeCheck.reason}` }
            }
            await page.goto(firstStep.url, { waitUntil: 'domcontentloaded', timeout: 15000 })
          }

          const sessionCheck = await verifySessionAfterRestore(page, '')

          if (!sessionCheck.authenticated) {
            return {
              ok: false,
              error: `Session expired after restore: ${sessionCheck.reason}. The user must re-login.`,
              sessionExpired: true,
              value: {
                flowName,
                method: 'session-restore',
                cookiesSet: cookies.length,
                expiredSkipped: expiredCount,
                finalUrl: page.url(),
              },
            }
          }

          return {
            ok: true,
            value: {
              flowName,
              method: 'session-restore',
              cookiesSet: cookies.length,
              expiredSkipped: expiredCount,
              finalUrl: page.url(),
            },
          }
        }
      }
    }

    const steps = (flow.properties.steps as any[]) || []
    let executed = 0

    for (const step of steps) {
      try {
        switch (step.action) {
          case 'navigate':
            if (step.url) {
              const scopeCheck = isUrlInScope(step.url)
              if (!scopeCheck.allowed) {
                log.warn(`ScopeGuard: skipping navigate to ${step.url} — ${scopeCheck.reason}`)
                break
              }
              await page.goto(step.url, { waitUntil: 'domcontentloaded', timeout: 15000 })
            }
            break
          case 'fill':
            if (step.selector && step.value) await page.fill(step.selector, step.value)
            break
          case 'click':
            if (step.selector) await page.click(step.selector)
            break
          case 'select':
            if (step.selector && step.value) await page.selectOption(step.selector, step.value)
            break
          case 'submit':
            if (step.selector) await page.press(step.selector, 'Enter')
            break
        }
        executed++
      } catch (err) {
        log.dim(`Flow step failed: ${step.action} — ${err instanceof Error ? err.message : String(err)}`)
        break
      }
    }

    return {
      ok: true,
      value: {
        flowName,
        method: 'form-replay',
        stepsExecuted: executed,
        totalSteps: steps.length,
        finalUrl: page.url(),
      },
    }
  },
})
