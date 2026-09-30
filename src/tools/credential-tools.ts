import { createTool } from '@mastra/core/tools'
import { z } from 'zod'
import { getConfig } from '../config'
import { getActivePage, getActiveBrowser, getActiveBrowserContext, getActiveCamofoxSession } from '../browser/manager'
import { isCamofoxHandle } from '../browser/provider'
import { getGlobalSessionManager } from '../http/session-manager'
import { isUrlInScope } from '../safety/scope-guard'
import { maskSecret } from '../capture/har-parser'
import { log } from '../utils/logger'

/**
 * Credential tool — the ONLY sanctioned path for the agent to use user-supplied
 * test accounts. Plaintext passwords are NEVER echoed into model-facing text or
 * the prompt (see P0-01). Instead:
 *   - `list`  → returns available role names only (no secrets).
 *   - `reveal`→ returns the login identifier (email) + a MASKED password so the
 *               agent can identify the account without ever seeing the secret.
 *   - `login` → performs the login form-fill out-of-band via the active browser
 *               page. The real password is read from config at execution time and
 *               handed straight to the browser automation layer; only a masked
 *               confirmation is returned to the model.
 */
export const useCredential = createTool({
  id: 'useCredential',
  description:
    'Use a user-supplied test account by ROLE (never by typing a password yourself). ' +
    "action='list' lists available roles; action='reveal' returns the account email and a MASKED password; " +
    "action='login' fills and submits the login form in the live browser using the stored credential for that role. " +
    'Passwords are never returned in plaintext — the tool injects them into the browser directly.',
  inputSchema: z.object({
    action: z.enum(['list', 'reveal', 'login']),
    role: z.string().optional().describe('The credential role, e.g. "admin" or "user". Required for reveal/login.'),
  }),
  outputSchema: z.object({
    ok: z.boolean(),
    roles: z.array(z.string()).optional(),
    email: z.string().optional(),
    maskedPassword: z.string().optional(),
    message: z.string(),
  }),
  execute: async ({ action, role }) => {
    const credentials = getConfig().credentials ?? {}
    const roles = Object.keys(credentials)

    if (action === 'list') {
      return {
        ok: roles.length > 0,
        roles,
        message: roles.length > 0
          ? `Available credential roles: ${roles.join(', ')}`
          : 'No credentials configured for this engagement.',
      }
    }

    if (!role) {
      return { ok: false, message: `action='${action}' requires a "role". Available: ${roles.join(', ') || '(none)'}` }
    }

    const cred = credentials[role]
    if (!cred) {
      return { ok: false, roles, message: `No credential for role "${role}". Available: ${roles.join(', ') || '(none)'}` }
    }

    if (action === 'reveal') {
      return {
        ok: true,
        email: cred.email,
        maskedPassword: maskSecret(cred.password),
        message: `Role "${role}" identifier is ${cred.email}. Password is redacted — use action='login' to authenticate.`,
      }
    }

    const page = await getActivePage()
    if (!page) {
      return { ok: false, message: 'No active browser page — navigate to the login page before calling login.' }
    }

    try {
      await performProviderLogin(page, cred.email, cred.password)
      const sessionName = await registerBrowserActor(role, page)
      if (!sessionName) {
        return { ok: false, email: cred.email, message: `Login actions completed for role "${role}", but no replayable actor session was captured. Verify the protected state and save the browser session.` }
      }
      log.info(`[useCredential] Logged in as role "${role}" (${cred.email})`)
      return {
        ok: true,
        email: cred.email,
        maskedPassword: maskSecret(cred.password),
        message: `Submitted login for role "${role}" (${cred.email}) and stored actor session ${sessionName}.`,
      }
    } catch (err) {
      return {
        ok: false,
        email: cred.email,
        message: `Login attempt for role "${role}" failed: ${err instanceof Error ? err.message : String(err)}`,
      }
    }
  },
})

async function performProviderLogin(page: any, email: string, password: string): Promise<void> {
  // Never interpolate credentials into a natural-language model action.
  // Both Stagehand v3 and Playwright expose provider-native locators, so the
  // secret stays in the browser process and never enters a model prompt.
  if (typeof page?.locator !== 'function') {
    throw new Error('The active browser page does not expose a provider-neutral login surface')
  }
  const passwordField = page.locator('input[type="password"]').first()
  let usernameField = page.locator('input[type="email"], input[autocomplete="username"], input[name*="user" i], input[name*="email" i]').first()
  if (typeof usernameField.count === 'function' && await usernameField.count() === 0) {
    usernameField = page.locator('input:not([type="password"])').first()
  }
  await usernameField.fill(email, { timeout: 8000 })
  await passwordField.fill(password, { timeout: 8000 })
  const submit = page.locator('button[type="submit"], input[type="submit"]').first()
  if (typeof submit.count === 'function' && await submit.count() > 0) {
    await submit.click({ timeout: 8000 })
  } else if (typeof passwordField.press === 'function') {
    await passwordField.press('Enter', { timeout: 8000 })
  } else {
    await passwordField.click({ timeout: 8000 })
  }
}

interface ActorWorkspace {
  page: any
  context: any
  close: () => Promise<void>
}

/**
 * Create a login workspace without mutating the primary investigation page.
 * Camoufox gets a real isolated Playwright context. Stagehand has one CDP
 * context, so it uses a fresh target page with a cookie snapshot/restore around
 * the login. The fallback is explicit and non-destructive for legacy handles.
 */
async function createActorWorkspace(loginUrl?: string): Promise<ActorWorkspace> {
  const activePage = await getActivePage()
  if (!activePage) throw new Error('No active browser page')
  const currentUrl = typeof activePage.url === 'function' ? String(activePage.url()) : ''
  const targetUrl = loginUrl ?? (currentUrl && currentUrl !== 'about:blank' ? currentUrl : undefined)
  const browser = (typeof getActiveBrowser === 'function' ? getActiveBrowser() : null)
    ?? (typeof getActiveCamofoxSession === 'function' ? getActiveCamofoxSession()?.handle : null)

  if (isCamofoxHandle(browser)) {
    const baseContext = browser.context as any
    const browserInstance = typeof baseContext?.browser === 'function' ? baseContext.browser() : undefined
    if (typeof browserInstance?.newContext === 'function') {
      const context = await browserInstance.newContext()
      const page = await context.newPage()
      if (targetUrl && typeof page.goto === 'function') {
        await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 15_000 })
      }
      return { page, context, close: async () => { await context.close() } }
    }
    if (typeof baseContext?.newPage === 'function') {
      const page = await baseContext.newPage()
      if (targetUrl && typeof page.goto === 'function') {
        await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 15_000 })
      }
      return { page, context: baseContext, close: async () => { await page.close?.() } }
    }
  }

  const stagehandContext = (browser as any)?.requireStagehand?.()?.context
  if (stagehandContext && typeof stagehandContext.newPage === 'function') {
    const originalPage = typeof stagehandContext.activePage === 'function' ? stagehandContext.activePage() : undefined
    const originalCookies = typeof stagehandContext.cookies === 'function' ? await stagehandContext.cookies() : []
    const page = await stagehandContext.newPage(targetUrl)
    if (typeof stagehandContext.clearCookies === 'function') await stagehandContext.clearCookies()
    let restored = false
    return {
      page,
      context: stagehandContext,
      close: async () => {
        if (!restored) {
          if (originalCookies.length > 0 && typeof stagehandContext.addCookies === 'function') {
            await stagehandContext.addCookies(originalCookies)
          }
          restored = true
        }
        if (originalPage && typeof stagehandContext.setActivePage === 'function') stagehandContext.setActivePage(originalPage)
        if (typeof page?.close === 'function') await page.close()
      },
    }
  }

  return { page: activePage, context: getActiveBrowserContext(), close: async () => {} }
}

/** Register the browser's post-login cookies/token in the shared actor store. */
async function registerBrowserActor(role: string, page: any, contextOverride?: any): Promise<string | undefined> {
  try {
    const currentUrl = typeof page.url === 'function' ? String(page.url()) : ''
    const origin = new URL(currentUrl).origin
    const context = contextOverride ?? (typeof getActiveBrowserContext === 'function' ? getActiveBrowserContext() : null)
    if (!context || typeof context.cookies !== 'function') return undefined

    const sessionName = `${role}:${origin}`
    const manager = getGlobalSessionManager()
    const session = manager.getSession(sessionName) ?? manager.createSession(sessionName, origin)
    const cookies = await context.cookies()
    for (const cookie of cookies ?? []) {
      if (cookie?.name && cookie?.value !== undefined) {
         manager.setCookie(sessionName, String(cookie.name), String(cookie.value), {
           domain: cookie.domain,
           path: cookie.path,
           secure: cookie.secure,
           httpOnly: cookie.httpOnly,
           expires: cookie.expires,
         })
       }
    }

    if (typeof page.evaluate === 'function') {
      const storage = (await page.evaluate(() => {
        const values: Record<string, string> = {}
        for (const source of [window.localStorage, window.sessionStorage]) {
          for (let i = 0; i < source.length; i++) {
            const key = source.key(i)
            if (key) values[key] = source.getItem(key) ?? ''
          }
        }
        return values
      })) as Record<string, string>
      const tokenEntry = Object.entries(storage ?? {}).find(([key, value]) => {
        const text = String(value)
        return text.length >= 8 && (/(?:auth|token|session)/i.test(key) || /^eyJ[A-Za-z0-9_-]+\./.test(text))
      })
      if (tokenEntry) manager.setToken(sessionName, tokenEntry[1])
    }
    return sessionName
  } catch {
    return undefined
  }
}

/**
 * Actor acquisition — turns configured credential roles into replayable
 * actor sessions for two-actor authorization testing (IDOR/BOLA). Logs
 * each role in through the live browser via the sanctioned useCredential
 * path (passwords never surface), then inventories the session store.
 * Roles that cannot be acquired are reported as failed, never faked: the
 * research loop fails closed on missing actors instead of downgrading to
 * anonymous differentials.
 */
export const acquireActors = createTool({
  id: 'acquireActors',
  description:
    'Log in configured credential roles through the live browser and register each as a replayable actor session for two-actor authorization testing (IDOR/BOLA cross-identity experiments). Returns the actor inventory; unacquired roles are reported as failed, never fabricated.',
  inputSchema: z.object({
    roles: z.array(z.string()).optional().describe('Subset of configured credential roles to acquire. Defaults to all configured roles.'),
    loginUrl: z.string().url().optional().describe('Authorized login URL used in an isolated actor workspace. Defaults to the current in-scope page.'),
  }),
  execute: async ({ roles, loginUrl }) => {
    if (loginUrl) {
      const scope = isUrlInScope(loginUrl)
      if (!scope.allowed) return { ok: false, error: `Scope violation: ${scope.reason}` }
    }
    const credentials = getConfig().credentials ?? {}
    const configured = Object.keys(credentials)
    const wanted = roles?.length ? roles.filter(r => credentials[r]) : configured
    const unknownRoles = (roles ?? []).filter(r => !credentials[r])
    const page = await getActivePage()
    if (!page) {
      return {
        ok: false,
        acquired: [],
        failed: wanted.map(role => ({ role, error: 'No active browser page — navigate to the login page before acquiring actors.' })),
        unknownRoles,
        actors: [] as Array<{ name: string; hasToken: boolean; cookieCount: number }>,
      }
    }
    const manager = getGlobalSessionManager()
    const acquired: Array<{ role: string; sessions: string[] }> = []
    const failed: Array<{ role: string; error: string }> = []
    for (const role of wanted) {
      const cred = credentials[role]
      let workspace: ActorWorkspace | undefined
      try {
        workspace = await createActorWorkspace(loginUrl)
        await performProviderLogin(workspace.page, cred.email, cred.password)
        const sessionName = await registerBrowserActor(role, workspace.page, workspace.context)
        if (sessionName) {
          acquired.push({ role, sessions: [sessionName] })
        } else {
          failed.push({ role, error: 'Login completed but no replayable actor session was captured.' })
        }
      } catch (error) {
        failed.push({ role, error: error instanceof Error ? error.message : String(error) })
      } finally {
        try { await workspace?.close() } catch { /* workspace cleanup is best effort */ }
      }
    }
    const actors = manager.listSessions().map(name => {
      const session = manager.exportSession(name)
      return {
        name,
        hasToken: !!session?.token,
        cookieCount: session ? Object.keys(session.cookies).length : 0,
      }
    })
    return {
      ok: failed.length === 0 && acquired.length > 0,
      acquired,
      failed,
      unknownRoles,
      actors,
    }
  },
})
