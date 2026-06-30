import type { Page } from 'playwright'

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

const SENSITIVE_SELECTORS = /pass|password|secret|token|auth|credential|ssn|credit|card/i
const SENSITIVE_INPUT_TYPES = /password|hidden/

export function maskValue(value: string, selector?: string, inputType?: string): string {
  if (inputType && SENSITIVE_INPUT_TYPES.test(inputType)) return '***'
  if (selector && SENSITIVE_SELECTORS.test(selector)) return '***'
  if (value.length > 200) return value.slice(0, 200) + '...'
  return value
}

function detectFlowType(actions: HumanAction[]): FlowGroup['type'] {
  const urls = actions.filter(a => a.type === 'navigate').map(a => a.url)
  const lastUrl = urls[urls.length - 1] || ''

  if (/login|auth|signin|oauth|sso/i.test(lastUrl) || /login|auth|signin/i.test(actions[0]?.url || '')) {
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

  attach(page: Page): void {
    this.detach()
    this.page = page
    this.capturing = true

    const isStagehand = typeof (page as any).sendCDP === 'function'

    if (isStagehand) {
      this.attachStagehand(page)
    } else {
      this.attachPlaywright(page)
    }
  }

  private attachStagehand(page: Page): void {
    const sp = page as any

    // In headless mode, Stagehand init script is not needed and can cause issues
    const isHeadless = typeof (page as any).isClosed === 'function' || 
                        typeof process !== 'undefined' && process.env.HEADLESS === 'true'

    if (!isHeadless) {
      sp.addInitScript(STAGEHAND_INIT_SCRIPT).catch(() => {})
    }

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

    page.on('console', consoleHandler)

    this.listeners = [
      () => { try { page.off('console', consoleHandler) } catch {} },
    ]
  }

  private attachPlaywright(page: Page): void {
    const onNavigate = (url: string) => {
      if (!this.capturing) return
      this.record({ type: 'navigate', url, timestamp: Date.now() })
    }

    const onClick = (element: any) => {
      if (!this.capturing) return
      const selector = this.buildSelector(element)
      const url = page.url()
      this.record({ type: 'click', selector, url, timestamp: Date.now(), label: element?.textContent?.trim()?.slice(0, 100) })
    }

    const onInput = (element: any) => {
      if (!this.capturing) return
      const selector = this.buildSelector(element)
      const inputType = element?.getAttribute?.('type') || ''

      const rawValue = element?.value || ''
      const value = maskValue(rawValue, selector, inputType)
      const url = page.url()
      this.record({ type: 'fill', selector, value, url, timestamp: Date.now(), metadata: { inputType } })
    }

    const onSelect = (element: any) => {
      if (!this.capturing) return
      const selector = this.buildSelector(element)
      const value = element?.value || ''
      const url = page.url()
      this.record({ type: 'select', selector, value, url, timestamp: Date.now() })
    }

    const onKeyDown = (element: any, event: any) => {
      if (!this.capturing) return
      if (event.key === 'Enter' && element?.tagName === 'INPUT') {
        const selector = this.buildSelector(element)
        this.record({ type: 'submit', selector, url: page.url(), timestamp: Date.now() })
      }
    }

    page.on('framenavigated', (frame: any) => {
      if (frame === page.mainFrame()) onNavigate(frame.url())
    })
    page.on('click', onClick)
    page.on('input', onInput)
    page.on('select', onSelect)
    page.on('keydown', onKeyDown)

    this.listeners = [
      () => { try { page.removeListener('navigate', onNavigate) } catch {} },
      () => { try { page.removeListener('click', onClick) } catch {} },
      () => { try { page.removeListener('input', onInput) } catch {} },
      () => { try { page.removeListener('select', onSelect) } catch {} },
      () => { try { page.removeListener('keydown', onKeyDown) } catch {} },
    ]
  }

  detach(): void {
    for (const cleanup of this.listeners) cleanup()
    this.listeners = []
    this.page = null
    this.capturing = false
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
    let lastNavigate = ''

    for (const action of this.actions) {
      if (action.type === 'navigate') {
        if (current.length > 0) {
          groups.push(this.buildFlowGroup(current))
        }
        current = [action]
        lastNavigate = action.url
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

  private buildSelector(element: any): string {
    if (!element) return 'unknown'

    const id = element.id ? `#${element.id}` : ''
    if (id) return id

    const testId = element.getAttribute?.('data-testid')
    if (testId) return `[data-testid="${testId}"]`

    const name = element.getAttribute?.('name')
    if (name) return `[name="${name}"]`

    const tagName = element.tagName?.toLowerCase() || 'unknown'
    const className = element.className ? `.${String(element.className).split(' ')[0]}` : ''
    return tagName + className
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
  if (!globalObserver) globalObserver = new HumanObserver()
  return globalObserver
}

export function setGlobalObserver(observer: HumanObserver): void {
  globalObserver = observer
}
