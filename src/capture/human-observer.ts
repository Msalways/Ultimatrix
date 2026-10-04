import type { Page } from 'playwright'
import type { AuthFlowType } from '../types/shared'
import { getTechniqueRegistry } from '../skills/technique-registry'
import { log } from '../utils/logger'
import { getGlobalDecisionLedger } from '../security/decision-ledger'
import { getEngagementServices } from '../runtime/engagement-context'
import { getCapturedRequestStore } from './captured-request-store'
import { isUrlInScope } from '../safety/scope-guard'

export type HumanActionType = 'click' | 'fill' | 'navigate' | 'select' | 'press' | 'hover' | 'submit'

export interface HumanAction {
  type: HumanActionType
  timestamp: number
  url: string
  selector?: string
  value?: string
  key?: string
  label?: string
  metadata?: Record<string, unknown>
}

export interface FlowGroup {
  type: 'login' | 'form-fill' | 'navigation' | 'custom'
  actions: HumanAction[]
  startUrl: string
  endUrl: string
  duration: number
}

// ─── Auth state detection ─────────────────────────────────────────────

export type AuthType = 'form' | 'oauth' | 'saml' | 'unknown'

export interface AuthState {
  hasLoginForm: boolean
  authType: AuthType
  loginEndpoint?: string
  oauthProviders: string[]
  hasPasswordField: boolean
  hasRememberMe: boolean
  formCount: number
}

const SAML_PATTERNS = [
  /saml/i, /saml2/i, /sso\/saml/i, /adfs/i, /okta.*saml/i,
  /onelogin.*saml/i, /ping.*federate/i,
]

/**
 * Map a detected auth type onto the graph's flow vocabulary.
 *
 * The two vocabularies are deliberately different: AuthType describes what was
 * SEEN on the page, AuthFlowType describes what kind of flow a node records. A
 * form-based login is a `login` flow; `unknown` still means a login form was
 * observed, so it is a `login` flow and not a discarded observation.
 */
export function toAuthFlowType(authType: AuthType): AuthFlowType {
  switch (authType) {
    case 'oauth': return 'oauth'
    case 'saml': return 'saml'
    case 'form': return 'login'
    default: return 'login'
  }
}

export class AuthStateDetector {
  private lastState: AuthState | null = null
  private stateChangeCallbacks: Array<(prev: AuthState | null, current: AuthState) => void> = []

  /**
   * Detect the current auth state of a page by inspecting DOM elements.
   * Returns structured auth state without any substring hacks.
   */
  async detectAuthState(page: Page): Promise<AuthState> {
    const state: AuthState = {
      hasLoginForm: false,
      authType: 'unknown',
      oauthProviders: [],
      hasPasswordField: false,
      hasRememberMe: false,
      formCount: 0,
    }

    try {
      const result = await page.evaluate(() => {
        const doc = document as any

        // Check for password fields
        const passwordFields = doc.querySelectorAll('input[type="password"]')
        const hasPasswordField = passwordFields.length > 0

        // Count forms
        const forms = doc.querySelectorAll('form')
        const formCount = forms.length

        // Check for login-related form content
        let hasLoginForm = false
        let loginEndpoint: string | undefined

        const loginPatterns = [
          /sign.?in/i, /log.?in/i, /authenticate/i, /credentials/i,
        ]
        const bodyText = doc.body?.innerText || ''

        // Check forms for password fields or login text
        for (const form of forms) {
          const hasPw = form.querySelector('input[type="password"]')
          const formText = form.textContent || ''
          if (hasPw || loginPatterns.some(p => p.test(formText))) {
            hasLoginForm = true
            if (form.action && form.action !== window.location.href) {
              loginEndpoint = form.action
            }
            break
          }
        }

        // Detect OAuth buttons/links
        const oauthProviders: string[] = []
        const allLinks = doc.querySelectorAll('a, button')
        for (const el of allLinks) {
          const text = (el.textContent || '').toLowerCase()
          const href = el.href || ''
          if (text.includes('google') || href.includes('accounts.google.com')) oauthProviders.push('Google')
          if (text.includes('github') || href.includes('github.com/login')) oauthProviders.push('GitHub')
          if (text.includes('facebook') || href.includes('facebook.com')) oauthProviders.push('Facebook')
          if (text.includes('microsoft') || href.includes('login.microsoftonline')) oauthProviders.push('Microsoft')
          if (text.includes('apple') || href.includes('appleid.apple.com')) oauthProviders.push('Apple')
        }

        // Check for remember me checkbox
        const rememberMe = doc.querySelector('input[name*="remember"], input[id*="remember"]')

        // Check page title and body for login indicators
        const titleText = doc.title || ''
        const allText = titleText + ' ' + bodyText

        return {
          hasPasswordField,
          formCount,
          hasLoginForm: hasLoginForm || (hasPasswordField && loginPatterns.some(p => p.test(allText))),
          loginEndpoint,
          oauthProviders: [...new Set(oauthProviders)],
          hasRememberMe: !!rememberMe,
        }
      })

      state.hasPasswordField = result.hasPasswordField
      state.formCount = result.formCount
      state.hasLoginForm = result.hasLoginForm
      state.loginEndpoint = result.loginEndpoint
      state.oauthProviders = result.oauthProviders
      state.hasRememberMe = result.hasRememberMe

      // Determine auth type
      if (state.oauthProviders.length > 0) {
        state.authType = 'oauth'
      } else if (SAML_PATTERNS.some(p => p.test(page.url()))) {
        state.authType = 'saml'
      } else if (state.hasLoginForm || state.hasPasswordField) {
        state.authType = 'form'
      }
    } catch {
      // Page may have navigated or be unavailable — return default state
      log.dim('[auth-state-detector] Failed to evaluate page for auth state')
    }

    // Notify state change listeners
    if (this.lastState === null || this.lastState.hasLoginForm !== state.hasLoginForm || this.lastState.authType !== state.authType) {
      for (const cb of this.stateChangeCallbacks) {
        cb(this.lastState, state)
      }
    }

    this.lastState = state
    return state
  }

  /**
   * Get the last detected auth state without re-scanning the page.
   */
  getLastState(): AuthState | null {
    return this.lastState
  }

  /**
   * Register a callback for auth state changes (e.g., navigation to login page).
   */
  onStateChange(callback: (prev: AuthState | null, current: AuthState) => void): void {
    this.stateChangeCallbacks.push(callback)
  }

  /**
   * Clear internal state (e.g., on detach).
   */
  clear(): void {
    this.lastState = null
    this.stateChangeCallbacks = []
  }
}

function getSensitiveRegex(): RegExp {
  const fields = getTechniqueRegistry().getSensitiveFields()
  return new RegExp(fields.join('|'), 'i')
}

const SENSITIVE_INPUT_TYPES = /password|hidden/

export function maskValue(value: string, selector?: string, inputType?: string): string {
  if (inputType && SENSITIVE_INPUT_TYPES.test(inputType)) return '***'
  if (selector && getSensitiveRegex().test(selector)) return '***'
  if (value.length > 200) return value.slice(0, 200) + '...'
  return value
}

function detectFlowType(actions: HumanAction[]): FlowGroup['type'] {
  const urls = actions.filter(a => a.type === 'navigate').map(a => a.url)
  const lastUrl = urls[urls.length - 1] || ''
  const loginPatterns = getTechniqueRegistry().getLoginUrlPatterns()
  const loginRegex = new RegExp(loginPatterns.join('|'), 'i')

  if (loginRegex.test(lastUrl) || loginRegex.test(actions[0]?.url || '')) {
    return 'login'
  }

  const hasFills = actions.some(a => a.type === 'fill')
  const hasClicks = actions.some(a => a.type === 'click' || a.type === 'submit')
  if (hasFills && hasClicks) return 'form-fill'

  const hasOnlyNavigation = actions.every(a => a.type === 'navigate' || a.type === 'click' || a.type === 'hover')
  if (hasOnlyNavigation) return 'navigation'

  return 'custom'
}

export const STAGEHAND_INIT_SCRIPT = `(function() {
  if (window.__humanObserver) return;
  window.__humanObserver = true;

  var desc = function(el) {
    if (!el) return 'unknown element';
    var parts = [];
    if (el.tagName) parts.push(el.tagName.toLowerCase());
    var label = el.labels && el.labels[0] ? el.labels[0].textContent.trim() : null;
    var placeholder = el.getAttribute ? el.getAttribute('placeholder') : null;
    var name = el.getAttribute ? el.getAttribute('name') : null;
    var text = el.textContent ? el.textContent.trim().slice(0, 40) : '';
    if (label) parts.push('labeled "' + label + '"');
    else if (placeholder) parts.push('placeholder "' + placeholder + '"');
    else if (name) parts.push('name="' + name + '"');
    else if (text) parts.push('"' + text + '"');
    return parts.join(' ');
  };

  var report = function(type, detail) {
    var obj = { type: type, url: location.href };
    for (var k in detail) { if (detail.hasOwnProperty(k)) obj[k] = detail[k]; }
    console.debug('__HUMAN__' + JSON.stringify(obj));
  };

  document.addEventListener('click', function(e) {
    report('click', { element: desc(e.target) });
  }, true);

  document.addEventListener('input', function(e) {
    report('fill', { element: desc(e.target), value: e.target.value, inputType: e.target.type });
  }, true);

  document.addEventListener('change', function(e) {
    if (e.target.tagName === 'SELECT')
      report('select', { element: desc(e.target), value: e.target.value });
  }, true);

  document.addEventListener('keydown', function(e) {
    if (e.key === 'Enter' && e.target.tagName === 'INPUT')
      report('submit', { element: desc(e.target) });
  }, true);

  var _p = history.pushState;
  history.pushState = function() { _p.apply(this, arguments); report('navigate', {}); };
  var _r = history.replaceState;
  history.replaceState = function() { _r.apply(this, arguments); report('navigate', {}); };
  window.addEventListener('popstate', function() { report('navigate', {}); });

  report('navigate', {});
})()`

export class HumanObserver {
  private page: Page | null = null
  private actions: HumanAction[] = []
  private listeners: Array<() => void> = []
  private callback: ((action: HumanAction) => void) | null = null
  private snapshotBeforeAsk: HumanAction[] = []
  private capturing = false
  private authDetector = new AuthStateDetector()

  /**
   * Get the auth state detector for this observer.
   * Use to detect login forms, OAuth buttons, SAML, etc.
   */
  getAuthDetector(): AuthStateDetector {
    return this.authDetector
  }

  attach(page: Page): void {
    this.detach()
    this.page = page
    this.capturing = true

    // Hook auth detection into navigation events.
    //
    // A detected login form used to be logged and nothing else, so the one
    // piece of ground truth that ends endpoint guessing — the REAL login
    // endpoint, read from the live form — was discarded and the model went on
    // inventing /api/login. Auth flows stayed at 0 in the graph on an app built
    // around authentication, which is exactly what was observed live against
    // OWASP Juice Shop (whose real endpoint is /rest/user/login).
    //
    // Observing a login form IS the knowledge. It belongs in the graph, not in a
    // log line. addAuthFlow is idempotent by (flowType, startUrl), so repeated
    // detections across navigations collapse to one node.
    this.authDetector.onStateChange((_prev, current) => {
      if (!current.hasLoginForm) return
      log.info(`[human-observer] Auth state changed: detected ${current.authType} login (endpoint: ${current.loginEndpoint || 'same-page'})`)
      try {
        const services = getEngagementServices()
        const startUrl = String(this.page?.url?.() ?? '')
        services?.graph?.addAuthFlow({
          flowType: toAuthFlowType(current.authType),
          startUrl,
          reusable: true,
          name: `${current.authType} login form`,
          description: current.loginEndpoint
            ? `Observed login form submitting to ${current.loginEndpoint} (password field: ${current.hasPasswordField}, forms on page: ${current.formCount})`
            : `Observed ${current.authType} login form on ${startUrl} (no form action observed; same-page submit)`,
          steps: [{ action: 'login-form-observed', url: current.loginEndpoint || startUrl }],
        })
      } catch (error) {
        // Persistence is best-effort: a failure here must never take down the
        // observer that is recording the interaction.
        log.warn(`[human-observer] could not persist observed auth flow: ${(error as Error)?.message ?? error}`)
      }
    })

    this.attachInjectedObserver(page)
  }

  private attachInjectedObserver(page: Page): void {
    const sp = page as any
    const services = getEngagementServices()
    const requestStore = services?.capturedRequests ?? getCapturedRequestStore()
    const requestStartedAt = new WeakMap<object, number>()

    if (typeof sp.addInitScript === 'function') sp.addInitScript(STAGEHAND_INIT_SCRIPT).catch(() => {})
    if (typeof sp.evaluate === 'function') sp.evaluate(STAGEHAND_INIT_SCRIPT).catch(() => {})

    const consoleHandler = (msg: any) => {
      if (!this.capturing) return
      const text = typeof msg.text === 'function' ? msg.text() : (msg.text ?? '')
      if (!text.startsWith('__HUMAN__')) return

      let data: any
      try {
        data = JSON.parse(text.slice(9))
      } catch { return }

      const selector = data.element || 'unknown element'
      const value = data.value ? maskValue(String(data.value), selector, data.inputType) : undefined

      this.record({
        type: data.type,
        selector,
        value,
        url: data.url || page.url(),
        timestamp: Date.now(),
        metadata: data.inputType ? { inputType: data.inputType } : undefined,
      })
    }

    const cleaners: Array<() => void> = []
    if (typeof (page as any).on === 'function') {
      try {
        ;(page as any).on('console', consoleHandler)
        cleaners.push(() => {
          try {
            const off = (page as any).off ?? (page as any).removeListener
            if (typeof off === 'function') off.call(page, 'console', consoleHandler)
          } catch {}
        })
      } catch (error) {
        log.dim(`[human-observer] console events unavailable: ${error instanceof Error ? error.message : String(error)}`)
      }

      const requestStartHandler = (request: any) => {
        const url = typeof request.url === 'function' ? request.url() : ''
        if (url && isUrlInScope(url, services ? services.scopeConfig : undefined, { allowAny: services?.allowAny }).allowed) {
          requestStartedAt.set(request, Date.now())
        }
      }
      const requestFinishHandler = async (request: any) => {
        const capturedAt = requestStartedAt.get(request)
        requestStartedAt.delete(request)
        if (!capturedAt) return
        try {
          const response = await request.response?.()
          let responseBody: string | undefined
          if (response?.body) {
            const body = await response.body().catch(() => undefined)
            if (body) responseBody = body.subarray(0, 1024 * 1024).toString('utf8')
          }
          requestStore.record({
            method: request.method(),
            url: request.url(),
            headers: await request.allHeaders().catch(() => request.headers()),
            body: request.postData() ?? undefined,
            ...(response ? {
              status: response.status(),
              responseHeaders: await response.allHeaders().catch(() => response.headers()),
              ...(responseBody !== undefined ? { responseBody } : {}),
            } : {}),
            source: 'browser',
            capturedAt,
          })
        } catch { /* a failed capture must not interfere with the user's browser */ }
      }
      try {
        ;(page as any).on('request', requestStartHandler)
        ;(page as any).on('requestfinished', requestFinishHandler)
        cleaners.push(() => {
          const off = (page as any).off ?? (page as any).removeListener
          if (typeof off === 'function') {
            off.call(page, 'request', requestStartHandler)
            off.call(page, 'requestfinished', requestFinishHandler)
          }
        })
      } catch (error) {
        log.dim(`[human-observer] live request capture unavailable: ${error instanceof Error ? error.message : String(error)}`)
      }
    }

    this.listeners = cleaners
  }

  detach(): void {
    for (const cleanup of this.listeners) cleanup()
    this.listeners = []
    this.page = null
    this.capturing = false
    this.authDetector.clear()
  }

  startSnapshot(): void {
    this.snapshotBeforeAsk = [...this.actions]
  }

  getActionsSinceSnapshot(): HumanAction[] {
    const snapshotLen = this.snapshotBeforeAsk.length
    this.snapshotBeforeAsk = []
    return this.actions.slice(snapshotLen)
  }

  record(action: Omit<HumanAction, 'url'> & { url: string }): void {
    const full: HumanAction = { ...action, timestamp: action.timestamp || Date.now() }
    this.actions.push(full)
    this.callback?.(full)

    // Slice 07: record the browser action decision + provenance. pageUrl is
    // redacted by the ledger — a browser action must never leak secrets.
    const actionId = `action:${full.type}:${full.timestamp}`
    getGlobalDecisionLedger().recordDecision({
      kind: 'browser.action',
      reason: `browser ${full.type} action`,
      sourceRefs: [actionId],
    })
    getGlobalDecisionLedger().recordProvenance({
      source: 'browser',
      pageUrl: full.url,
      actionId,
    })

    // Trigger auth state detection on navigations
    if (full.type === 'navigate' && this.page) {
      this.authDetector.detectAuthState(this.page).catch(() => {})
    }
  }

  getActions(): HumanAction[] {
    return [...this.actions]
  }

  getRecentActions(sinceMs?: number): HumanAction[] {
    if (!sinceMs) return this.getActions()
    const cutoff = Date.now() - sinceMs
    return this.actions.filter(a => a.timestamp >= cutoff)
  }

  getFlowGroups(): FlowGroup[] {
    const groups: FlowGroup[] = []
    let current: HumanAction[] = []

    for (const action of this.actions) {
      if (action.type === 'navigate') {
        if (current.length > 0) {
          groups.push(this.buildFlowGroup(current))
        }
        current = [action]
      } else {
        current.push(action)
      }
    }

    if (current.length > 0) {
      groups.push(this.buildFlowGroup(current))
    }

    return groups
  }

  private buildFlowGroup(actions: HumanAction[]): FlowGroup {
    const type = detectFlowType(actions)
    const urls = actions.filter(a => a.type === 'navigate').map(a => a.url)
    return {
      type,
      actions,
      startUrl: urls[0] || actions[0]?.url || '',
      endUrl: urls[urls.length - 1] || actions[actions.length - 1]?.url || '',
      duration: actions.length > 1 ? actions[actions.length - 1].timestamp - actions[0].timestamp : 0,
    }
  }

  clear(): void {
    this.actions = []
    this.snapshotBeforeAsk = []
  }

  onAction(callback: (action: HumanAction) => void): void {
    this.callback = callback
  }

  isCapturing(): boolean {
    return this.capturing
  }
}
let globalObserver: HumanObserver | null = null

export function getGlobalObserver(): HumanObserver {
  const owned = getEngagementServices()?.humanObserver
  if (owned) return owned
  if (!globalObserver) globalObserver = new HumanObserver()
  return globalObserver
}

export function setGlobalObserver(observer: HumanObserver): void {
  const owned = getEngagementServices()
  if (owned) {
    owned.humanObserver = observer
    return
  }
  globalObserver = observer
}
