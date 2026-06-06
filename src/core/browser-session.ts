import { chromium, type Browser, type BrowserContext, type Page } from 'playwright';
import fs from 'fs';
import path from 'path';

export interface TraceEntry {
  type: 'navigation' | 'xhr' | 'fetch' | 'form' | 'resource' | 'script';
  url: string;
  method: string;
  status: number;
  requestHeaders: Record<string, string>;
  requestBody?: string;
  responseHeaders: Record<string, string>;
  sourcePage: string;
  timestamp: number;
  duration: number;
}

export interface MacroStep {
  type: 'navigate' | 'click' | 'fill' | 'wait' | 'extract' | 'screenshot' | 'evaluate';
  selector?: string;
  value?: string;
  url?: string;
  script?: string;
  waitMs?: number;
}

export interface MacroResult {
  success: boolean;
  stepResults: { step: number; type: string; ok: boolean; error?: string }[];
  finalUrl?: string;
  extractedData?: Record<string, string>;
  screenshots?: string[];
  duration: number;
}

interface SessionState {
  browser: Browser;
  context: BrowserContext;
  page: Page;
  createdAt: number;
  trace: TraceEntry[];
  tracing: boolean;
  label?: string;
  userAgent?: string;
}

export class BrowserSessionManager {
  private sessions = new Map<string, SessionState>();
  private recordings = new Map<string, MacroStep[]>();
  private stepStreams = new Map<string, fs.WriteStream>();
  private headless: boolean;
  framework = '';

  setFramework(fw: string) { this.framework = fw; }

  constructor(headless = false) {
    this.headless = headless;
  }

  async getOrCreate(sessionId: string, options?: { label?: string; userAgent?: string; viewport?: { width: number; height: number } }): Promise<Page> {
    const existing = this.sessions.get(sessionId);
    if (existing) {
      try {
        await existing.page.evaluate('1');
        return existing.page;
      } catch {
        await this.close(sessionId);
      }
    }

    const browser = await chromium.launch({
      headless: this.headless,
      args: [
        '--no-sandbox',
        '--disable-blink-features=AutomationControlled',
        '--disable-automation',
        '--disable-dev-shm-usage',
        '--disable-web-security',
        '--disable-features=IsolateOrigins,site-per-process',
      '--start-maximized',
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-popup-blocking',
        '--disable-session-crashed-bubble',
        '--disable-component-update',
        '--no-service-autorun',
        '--password-store=basic',
        '--use-mock-keychain',
        '--hide-scrollbars',
        '--mute-audio',
        '--disable-background-networking',
        '--disable-breakpad',
        '--disable-sync',
      ],
    });
    const context = await browser.newContext({
      viewport: options?.viewport || { width: 1280, height: 720 },
      userAgent: options?.userAgent || 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
      locale: 'en-US',
      timezoneId: 'America/New_York',
      geolocation: { latitude: 40.7128, longitude: -74.006 },
      permissions: ['geolocation'],
      deviceScaleFactor: 2,
      hasTouch: false,
      isMobile: false,
    });
    // Context-level init script: runs for EVERY page in this context,
    // INCLUDING the initial about:blank document that newPage() creates.
    // This is critical for the __name shim — page.addInitScript only
    // runs on navigations AFTER it's added, so the very first page.evaluate
    // on a fresh session (e.g. scanInteractive before any goto) would
    // otherwise throw "ReferenceError: __name is not defined".
    await context.addInitScript(() => {
      // esbuild keepNames helper — tsx transpiles typed arrows into __name(fn, "name").
      // Browser has no such helper; this is a documented no-op polyfill (esbuild's
      // real helper is `(fn) => fn` — it just lets the bundler preserve the name
      // string for stack traces and debugging).
      // @ts-expect-error - globalThis extension
      globalThis.__name = (fn: unknown) => fn;
    });
    const page = await context.newPage();
    // Page-level init scripts: anti-fingerprinting overrides for
    // Cloudflare / bot detection. These need window/navigator to be
    // already initialized (which about:blank provides), so they can
    // safely run at the page level.
    await page.addInitScript(() => {
      Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
      // @ts-expect-error - chrome runtime override
      window.chrome = { runtime: {} };
      Object.defineProperty(navigator, 'plugins', { get: () => [1, 2, 3, 4, 5] as any });
      Object.defineProperty(navigator, 'languages', { get: () => ['en-US', 'en'] });
    });

    this.sessions.set(sessionId, { browser, context, page, createdAt: Date.now(), trace: [], tracing: false, label: options?.label, userAgent: options?.userAgent });
    if (!this.headless) page.bringToFront().catch(() => {});
    return page;
  }

  async startTrace(sessionId: string): Promise<string> {
    const page = await this.getOrCreate(sessionId);
    const state = this.sessions.get(sessionId)!;
    if (state.tracing) return `Tracing already active for session "${sessionId}".`;

    state.tracing = true;
    state.trace = [];

    const startTime = Date.now();

    state.context.on('request', (req) => {
      if (!state.tracing) return;
      const resourceType = req.resourceType();
      let type: TraceEntry['type'] = 'resource';
      if (resourceType === 'document') type = 'navigation';
      else if (resourceType === 'xhr') type = 'xhr';
      else if (resourceType === 'fetch') type = 'fetch';
      else if (resourceType === 'form') type = 'form';
      else if (resourceType === 'script') type = 'script';

      state.trace.push({
        type,
        url: req.url(),
        method: req.method(),
        status: 0,
        requestHeaders: req.headers(),
        requestBody: req.postData() || undefined,
        responseHeaders: {},
        sourcePage: state.page.url(),
        timestamp: Date.now() - startTime,
        duration: 0,
      });
    });

    state.context.on('response', (res) => {
      if (!state.tracing) return;
      const url = res.url();
      const entry = [...state.trace].reverse().find(e => e.url === url && e.status === 0);
      if (entry) {
        entry.status = res.status();
        entry.responseHeaders = res.headers();
        entry.duration = Date.now() - startTime - entry.timestamp;
      }
    });

    return `Tracing started for session "${sessionId}". All network requests will be captured.`;
  }

  stopTrace(sessionId: string): TraceEntry[] {
    const state = this.sessions.get(sessionId);
    if (!state) return [];
    state.tracing = false;
    const entries = state.trace;
    state.trace = [];
    return entries;
  }

  getTrace(sessionId: string): TraceEntry[] {
    return this.sessions.get(sessionId)?.trace || [];
  }

  startRecording(sessionId: string): void {
    this.recordings.set(sessionId, []);
  }

  stopRecording(sessionId: string): MacroStep[] {
    const steps = this.recordings.get(sessionId) || [];
    this.recordings.delete(sessionId);
    return steps;
  }

  getRecording(sessionId: string): MacroStep[] {
    return this.recordings.get(sessionId) || [];
  }

  private record(sessionId: string, step: MacroStep): void {
    const recording = this.recordings.get(sessionId);
    if (recording) recording.push(step);
    const stream = this.stepStreams.get(sessionId);
    if (stream) stream.write(JSON.stringify(step) + '\n');
  }

  private manualListeners = new Map<string, () => void>();

  /** Start recording manual user interactions in the visible Playwright browser.
   *  The human can click, type, and navigate directly in the browser window.
   *  These actions are captured as MacroStep entries via injected DOM listeners.
   *  If streamPath is provided, each step is appended as a JSON line to that file.
   *  If onStep is provided, each captured step is also passed to this callback in real time. */
  async startManualRecording(sessionId: string, streamPath?: string, onStep?: (step: MacroStep) => void): Promise<string> {
    if (this.manualListeners.has(sessionId)) {
      return `Manual recording already active for session "${sessionId}".`;
    }

    const page = await this.getOrCreate(sessionId);

    // Ensure a recording buffer exists
    if (!this.recordings.has(sessionId)) this.startRecording(sessionId);

    // Open write stream for NDJSON if path provided
    if (streamPath) {
      fs.mkdirSync(path.dirname(streamPath), { recursive: true });
      this.stepStreams.set(sessionId, fs.createWriteStream(streamPath, { flags: 'a' }));
    }

    // Expose Node.js callbacks to the browser page
    await page.exposeFunction('__ul_recordClick', (selector: string) => {
      const step: MacroStep = { type: 'click', selector };
      this.record(sessionId, step);
      onStep?.(step);
    });

    await page.exposeFunction('__ul_recordInput', (selector: string, value: string) => {
      const step: MacroStep = { type: 'fill', selector, value };
      this.record(sessionId, step);
      onStep?.(step);
    });

    await page.exposeFunction('__ul_recordNavigate', (url: string) => {
      const step: MacroStep = { type: 'navigate', url };
      this.record(sessionId, step);
      onStep?.(step);
    });

    // Inject DOM event listeners into the page
    // Use string evaluate to avoid esbuild/tsx keepNames __name wrapping
    const injectScript = `(function() {
      var prev = window.__ul_cleanup;
      if (typeof prev === 'function') prev();

      function gen(el) {
        if (el.id) return '#' + CSS.escape(el.id);
        var t = el.tagName.toLowerCase();
        var c = Array.from(el.classList).slice(0, 2).map(function(x) { return CSS.escape(x); }).join('.');
        if (c) return t + '.' + c;
        var p = el.parentElement;
        if (p) { var i = Array.from(p.children).indexOf(el) + 1; return t + ':nth-child(' + i + ')'; }
        return t;
      }

      function ch(e) {
        var el = e.target;
        if (!el || !el.tagName) return;
        window.__ul_recordClick(gen(el));
      }
      function ih(e) {
        var el = e.target;
        if (!el || !el.tagName || (!el.name && !el.id)) return;
        var v = el.value;
        if (v === undefined || v === null) return;
        if (window.__ul_t) clearTimeout(window.__ul_t);
        window.__ul_t = setTimeout(function() { window.__ul_recordInput(gen(el), String(v)); }, 400);
      }

      document.addEventListener('click', ch, true);
      document.addEventListener('input', ih, true);

      window.__ul_cleanup = function() {
        document.removeEventListener('click', ch, true);
        document.removeEventListener('input', ih, true);
      };
    })()`;

    await page.evaluate(injectScript);

    // Detect full-page navigations from URL changes
    const navHandler = (frame: any) => {
      if (frame === page.mainFrame()) {
        const url = frame.url();
        if (url && url !== 'about:blank') {
          const step: MacroStep = { type: 'navigate', url };
          this.record(sessionId, step);
          onStep?.(step);
        }
      }
    };
    page.on('framenavigated', navHandler);

    // Re-inject DOM listeners after every page load (survives navigation)
    const loadReInject = () => {
      page.evaluate(injectScript).catch(() => {});
    };
    page.on('load', loadReInject);

    this.manualListeners.set(sessionId, () => {
      page.removeListener('framenavigated', navHandler);
      page.removeListener('load', loadReInject);
    });

    return `Manual recording started for session "${sessionId}". Interact with the visible browser window directly — clicks, fills, and navigations are captured.`;
  }

  /** Stop manual recording and return captured steps. Does NOT clear the main recording buffer. */
  async stopManualRecording(sessionId: string): Promise<MacroStep[]> {
    const cleanup = this.manualListeners.get(sessionId);
    if (cleanup) {
      cleanup();
      this.manualListeners.delete(sessionId);
    }

    // Close the step stream
    const stream = this.stepStreams.get(sessionId);
    if (stream) {
      stream.end();
      this.stepStreams.delete(sessionId);
    }

    try {
      const page = this.sessions.get(sessionId)?.page;
      if (page) {
        await page.evaluate(`(function() {
          if (typeof window.__ul_cleanup === 'function') window.__ul_cleanup();
          delete window.__ul_cleanup;
          delete window.__ul_recordClick;
          delete window.__ul_recordInput;
          delete window.__ul_recordNavigate;
        })()`).catch(() => {});
      }
    } catch { /* best effort */ }

    // Return steps captured during manual mode without clearing the main recording
    return this.getRecording(sessionId);
  }

  async navigate(sessionId: string, url: string, opts?: { relaxed?: boolean }): Promise<string> {
    const page = await this.getOrCreate(sessionId);
    if (!this.headless) page.bringToFront().catch(() => {});
    let firstError: Error | null = null;
    for (const waitUntil of ['load', 'domcontentloaded'] as const) {
      try {
        await page.goto(url, { waitUntil, timeout: 30000 });
        const finalUrl = page.url();
        if (finalUrl && finalUrl !== 'about:blank') {
          this.record(sessionId, { type: 'navigate', url });
          return finalUrl;
        }
        if (opts?.relaxed) return finalUrl;
      } catch (e) {
        if (!firstError) firstError = e instanceof Error ? e : new Error(String(e));
      }
    }
    throw new Error(
      `Failed to navigate to ${url}: final URL was "${await page.url()}". ` +
      (firstError ? `First error: ${firstError.message}` : 'No error thrown (page loaded but returned about:blank — likely bot detection)'),
    );
  }

  async click(sessionId: string, selector: string): Promise<string> {
    const page = await this.getOrCreate(sessionId);
    if (!this.headless) page.bringToFront().catch(() => {});
    try {
      await page.waitForSelector(selector, { timeout: 10000 });
      try {
        await page.click(selector, { force: true, timeout: 5000 });
      } catch {
        await page.evaluate((sel) => {
          const el = document.querySelector(sel) as HTMLElement;
          if (el) el.click();
        }, selector);
      }
      this.record(sessionId, { type: 'click', selector });
      return `Clicked: ${selector}`;
    } catch {
      // CSS selector failed — try matching by link text or href
      const clicked = await page.evaluate((text) => {
        const links = Array.from(document.querySelectorAll('a'));
        const match = links.find(l => l.textContent?.trim() === text || l.href === text);
        if (match) { (match as HTMLElement).click(); return match.href; }
        const buttons = Array.from(document.querySelectorAll('button'));
        const bMatch = buttons.find(b => b.textContent?.trim() === text);
        if (bMatch) { (bMatch as HTMLElement).click(); return bMatch.textContent || ''; }
        return null;
      }, selector);
      if (clicked) {
        this.record(sessionId, { type: 'click', selector });
        return `Clicked by text match: "${selector}" → ${clicked}`;
      }
      return `Could not find element matching "${selector}"`;
    }
  }

  async fill(sessionId: string, selector: string, value: string): Promise<string> {
    const page = await this.getOrCreate(sessionId);
    if (!this.headless) page.bringToFront().catch(() => {});
    try { await page.waitForSelector(selector, { timeout: 5000 }); } catch {}
    // Focus and clear
    await page.evaluate((sel) => {
      const el = document.querySelector(sel) as HTMLElement | null;
      if (el) el.focus();
    }, selector);
    await page.keyboard.press('End');
    await page.keyboard.down('Shift');
    await page.keyboard.press('Home');
    await page.keyboard.up('Shift');
    await page.keyboard.press('Backspace');
    await page.keyboard.insertText(value);
    this.record(sessionId, { type: 'fill', selector, value });
    return `Filled: ${selector}`;
  }

  async getCurrentUrl(sessionId: string): Promise<string> {
    const page = await this.getOrCreate(sessionId);
    return page.url();
  }

  async pressKey(sessionId: string, key: string): Promise<string> {
    const page = await this.getOrCreate(sessionId);
    await page.keyboard.press(key);
    return `Pressed: ${key}`;
  }

  async screenshot(sessionId: string, fullPage = false): Promise<string> {
    const page = await this.getOrCreate(sessionId);
    const buffer = await page.screenshot({ fullPage, type: 'png' });
    return buffer.toString('base64');
  }

  async extractText(sessionId: string): Promise<string> {
    const page = await this.getOrCreate(sessionId);
    return page.evaluate(() => document.body?.innerText || '');
  }

  async extractHtml(sessionId: string): Promise<string> {
    const page = await this.getOrCreate(sessionId);
    try {
      const html = await page.evaluate(() => document.documentElement?.outerHTML || '');
      return html.length > 10000 ? html.slice(0, 10000) + '\n... (truncated)' : html;
    } catch {
      const html = await page.content();
      return html.length > 10000 ? html.slice(0, 10000) + '\n... (truncated)' : html;
    }
  }

  async extractLinks(sessionId: string): Promise<string> {
    const page = await this.getOrCreate(sessionId);
    const links: Array<{ href: string; rawHref: string; text: string }> = await page.evaluate(() =>
      Array.from(document.querySelectorAll('a[href]')).map((a) => ({
        href: (a as HTMLAnchorElement).href,
        rawHref: (a as HTMLAnchorElement).getAttribute('href') || '',
        text: ((a as HTMLAnchorElement).textContent || '').trim().slice(0, 80),
      }))
    );
    return links.map((l) => `${l.href} (${l.text})\n  selector: a[href="${l.rawHref}"]`).join('\n');
  }

  async evaluate(sessionId: string, script: string): Promise<string> {
    const page = await this.getOrCreate(sessionId);
    const result = await page.evaluate(script);
    return typeof result === 'string' ? result : JSON.stringify(result, null, 2);
  }

  async extractForms(sessionId: string): Promise<string> {
    const page = await this.getOrCreate(sessionId);
    const forms = await page.evaluate(() =>
      Array.from(document.querySelectorAll('form')).map((f, i) => ({
        index: i,
        action: (f as HTMLFormElement).action || f.getAttribute('action') || '',
        method: ((f as HTMLFormElement).method || f.getAttribute('method') || 'GET').toUpperCase(),
        fields: Array.from(f.querySelectorAll('input, textarea, select, button')).map((el) => ({
          name: (el as HTMLInputElement).name || '',
          type: (el as HTMLInputElement).type || el.tagName.toLowerCase(),
          placeholder: (el as HTMLInputElement).placeholder || '',
          required: (el as HTMLInputElement).required || false,
          value: (el as HTMLInputElement).value || '',
        })),
      }))
    );
    return JSON.stringify(forms, null, 2);
  }

  /**
   * Extract every interactive element on the current page: buttons, links
   * (text + href), input fields (name + type), and clickable elements.
   * Returned as JSON with category, selector, label, and metadata.
   */
  async extractInteractiveElements(sessionId: string): Promise<string> {
    const page = await this.getOrCreate(sessionId);
    const result = await page.evaluate(() => {
      function genSelector(el: Element): string {
        if (el.id) return '#' + (window.CSS?.escape?.(el.id) ?? el.id);
        const t = el.tagName.toLowerCase();
        const cls = Array.from(el.classList).slice(0, 2).map((c) => '.' + (window.CSS?.escape?.(c) ?? c)).join('');
        if (cls) return t + cls;
        const p = el.parentElement;
        if (p) {
          const i = Array.from(p.children).indexOf(el) + 1;
          return `${t}:nth-child(${i})`;
        }
        return t;
      }
      const buttons = Array.from(document.querySelectorAll('button, input[type="button"], input[type="submit"], [role="button"]')).map((el) => {
        const e = el as HTMLButtonElement | HTMLInputElement;
        return {
          kind: 'button' as const,
          selector: genSelector(e),
          text: ((e.textContent || (e as HTMLInputElement).value) ?? '').trim().slice(0, 80),
          type: (e as HTMLInputElement).type || 'button',
          disabled: e.disabled || false,
        };
      });
      const links = Array.from(document.querySelectorAll('a[href]')).map((el) => {
        const a = el as HTMLAnchorElement;
        return {
          kind: 'link' as const,
          selector: genSelector(a),
          href: a.href,
          text: (a.textContent ?? '').trim().slice(0, 80),
        };
      });
      const inputs = Array.from(document.querySelectorAll('input, textarea, select')).map((el) => {
        const i = el as HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;
        return {
          kind: 'input' as const,
          selector: genSelector(i),
          name: i.name || '',
          type: (i as HTMLInputElement).type || i.tagName.toLowerCase(),
          placeholder: (i as HTMLInputElement).placeholder || '',
          required: (i as HTMLInputElement).required || false,
        };
      });
      const clickable = Array.from(document.querySelectorAll('[onclick], [role="link"], [tabindex="0"]')).filter((el) => {
        return !buttons.some((b) => b.selector === genSelector(el)) && !links.some((l) => l.selector === genSelector(el));
      }).map((el) => ({
        kind: 'clickable' as const,
        selector: genSelector(el),
        text: (el.textContent ?? '').trim().slice(0, 80),
        role: el.getAttribute('role') ?? '',
      }));
      return { buttons, links, inputs, clickable };
    });
    return JSON.stringify(result, null, 2);
  }

  async getCookies(sessionId: string): Promise<string> {
    const page = await this.getOrCreate(sessionId);
    const cookies = await page.context().cookies();
    return JSON.stringify(cookies.map(c => ({ name: c.name, value: c.value.slice(0, 40), domain: c.domain, path: c.path, httpOnly: c.httpOnly, secure: c.secure, sameSite: c.sameSite })), null, 2);
  }

  async getLocalStorage(sessionId: string): Promise<string> {
    const page = await this.getOrCreate(sessionId);
    const result = await page.evaluate(() => {
      const items: Record<string, string> = {};
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k) items[k] = localStorage.getItem(k) || '';
      }
      return items;
    });
    return JSON.stringify(result, null, 2);
  }

  async getScripts(sessionId: string): Promise<string> {
    const page = await this.getOrCreate(sessionId);
    const scripts = await page.evaluate(() =>
      Array.from(document.querySelectorAll('script[src]')).map(s => ({
        src: (s as HTMLScriptElement).src,
        async: (s as HTMLScriptElement).async,
        defer: (s as HTMLScriptElement).defer,
      }))
    );
    return JSON.stringify(scripts, null, 2);
  }

  async addCookie(sessionId: string, name: string, value: string, url?: string): Promise<string> {
    const page = await this.getOrCreate(sessionId);
    const cookieUrl = url || page.url();
    await page.context().addCookies([{ name, value, url: cookieUrl, httpOnly: false, secure: false, sameSite: 'Lax' as const }]);
    return `Cookie "${name}" set for ${cookieUrl}`;
  }

  async close(sessionId: string): Promise<void> {
    const state = this.sessions.get(sessionId);
    if (!state) return;
    try { await state.page.close(); } catch { /* ok */ }
    try { await state.context.close(); } catch { /* ok */ }
    try { await state.browser.close(); } catch { /* ok */ }
    this.sessions.delete(sessionId);
  }

  async closeAll(): Promise<void> {
    for (const id of this.sessions.keys()) await this.close(id);
  }

  listSessions(): string[] {
    return Array.from(this.sessions.keys());
  }

  hasSession(sessionId: string): boolean {
    return this.sessions.has(sessionId);
  }

  async saveStorageState(sessionId: string, filePath: string): Promise<string> {
    const page = await this.getOrCreate(sessionId);
    const cookies = await page.context().cookies();
    const storageItems = await page.evaluate(() => {
      const items: Record<string, string> = {};
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k) items[k] = localStorage.getItem(k) || '';
      }
      return items;
    });
    const state = { cookies, localStorage: storageItems, savedAt: Date.now(), url: page.url() };
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, JSON.stringify(state, null, 2));
    return `Saved storage state (${cookies.length} cookies, ${Object.keys(storageItems).length} localStorage items) to ${filePath}`;
  }

  async loadStorageState(sessionId: string, filePath: string): Promise<string> {
    if (!fs.existsSync(filePath)) return `Storage state file not found: ${filePath}`;
    const state = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    const page = await this.getOrCreate(sessionId);
    if (state.cookies?.length) {
      await page.context().addCookies(state.cookies.map((c: any) => ({
        name: c.name, value: c.value, domain: c.domain, path: c.path,
        httpOnly: c.httpOnly ?? false, secure: c.secure ?? false, sameSite: c.sameSite || 'Lax',
      })));
    }
    if (state.localStorage) {
      await page.evaluate((items) => {
        for (const [k, v] of Object.entries(items)) {
          localStorage.setItem(k, v as string);
        }
      }, state.localStorage);
    }
    return `Loaded storage state (${state.cookies?.length || 0} cookies, ${Object.keys(state.localStorage || {}).length} localStorage items) from ${filePath}`;
  }

  getSessionInfo(sessionId: string): Record<string, unknown> | null {
    const state = this.sessions.get(sessionId);
    if (!state) return null;
    return {
      id: sessionId,
      label: state.label || null,
      userAgent: state.userAgent || null,
      createdAt: new Date(state.createdAt).toISOString(),
      url: state.page.url(),
      tracing: state.tracing,
      traceLength: state.trace.length,
    };
  }

  async replayMacro(sessionId: string, steps: MacroStep[]): Promise<MacroResult> {
    const startTime = Date.now();
    const stepResults: MacroResult['stepResults'] = [];
    let anyFailed = false;
    const extractedData: Record<string, string> = {};
    const screenshots: string[] = [];

    for (let i = 0; i < steps.length; i++) {
      const step = steps[i];
      try {
        switch (step.type) {
          case 'navigate': {
            if (!step.url) throw new Error('navigate step requires url');
            const url = await this.navigate(sessionId, step.url);
            stepResults.push({ step: i, type: step.type, ok: true });
            break;
          }
          case 'click': {
            if (!step.selector) throw new Error('click step requires selector');
            await this.click(sessionId, step.selector);
            stepResults.push({ step: i, type: step.type, ok: true });
            break;
          }
          case 'fill': {
            if (!step.selector || step.value === undefined) throw new Error('fill step requires selector and value');
            await this.fill(sessionId, step.selector, step.value);
            stepResults.push({ step: i, type: step.type, ok: true });
            break;
          }
          case 'wait': {
            const ms = step.waitMs ?? 1000;
            await new Promise((resolve) => setTimeout(resolve, ms));
            stepResults.push({ step: i, type: step.type, ok: true });
            break;
          }
          case 'extract': {
            const text = await this.extractText(sessionId);
            const key = step.value || `extract_${i}`;
            extractedData[key] = text;
            stepResults.push({ step: i, type: step.type, ok: true });
            break;
          }
          case 'screenshot': {
            const base64 = await this.screenshot(sessionId);
            screenshots.push(base64);
            stepResults.push({ step: i, type: step.type, ok: true });
            break;
          }
          case 'evaluate': {
            if (!step.script) throw new Error('evaluate step requires script');
            await this.evaluate(sessionId, step.script);
            stepResults.push({ step: i, type: step.type, ok: true });
            break;
          }
          default:
            stepResults.push({ step: i, type: step.type, ok: false, error: `Unknown step type: ${step.type}` });
            anyFailed = true;
        }
      } catch (err) {
        anyFailed = true;
        stepResults.push({ step: i, type: step.type, ok: false, error: err instanceof Error ? err.message : String(err) });
      }
    }

    let finalUrl: string | undefined;
    try {
      const page = await this.getOrCreate(sessionId);
      finalUrl = page.url();
    } catch { /* ignore */ }

    return {
      success: !anyFailed,
      stepResults,
      finalUrl,
      extractedData: Object.keys(extractedData).length > 0 ? extractedData : undefined,
      screenshots: screenshots.length > 0 ? screenshots : undefined,
      duration: Date.now() - startTime,
    };
  }
}
