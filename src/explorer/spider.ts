import type { Page } from 'playwright';
import type { BrowserSessionManager, TraceEntry, MacroStep } from '../core/browser-session';
import { takeSnapshot, takeSnapshotDeep, isSamePage } from './dom-observer';
import type { DOMSnapshot } from './dom-observer';
import * as fs from 'fs';
import * as path from 'path';
import type { WorkflowStateGraph } from '../core/workflow-state';
import type { SessionPool } from '../core/session-pool';
import type { AuthFlow } from '../core/auth-flow';

export interface AuthConfig {
  username: string;
  password: string;
}

export interface RouteNode {
  path: string;
  title: string;
  depth: number;
  url: string;
  forms: number;
  linkCount: number;
  visitedAt: number;
  bodyPreview?: string;
  contentType?: string;
  status?: number;
}

export interface CrawlResult {
  baseUrl: string;
  totalRoutes: number;
  maxDepth: number;
  durationMs: number;
  routes: RouteNode[];
  visitedUrls: string[];
  errors: Array<{ url: string; error: string }>;
  trace: TraceEntry[];
  recording: MacroStep[];
  snapshots: DOMSnapshot[];
  cookies: Record<string, string>;
  localStorage: Record<string, string>;
  sessionStorage: Record<string, string>;
  techStack: string[];
  storageStatePath: string;
  loginEndpoint: string;
  loginMethod: string;
  loginFields: string[];
}

const STATIC_EXT = /\.(css|js|woff2?|png|svg|ico|map|jpg|jpeg|gif|webp|ttf|eot|pdf)$/i;
const SKIP_PREFIXES = ['tel:', 'mailto:', 'javascript:', 'blob:', 'data:', 'file:', 'ftp:'];
const MAX_PAGES = 50;

export class SpiderCrawler {
  private manager: BrowserSessionManager;
  private sessionId: string;

  constructor(manager: BrowserSessionManager, sessionId = 'default') {
    this.manager = manager;
    this.sessionId = sessionId;
  }

  async crawl(
    targetUrl: string,
    maxDepth = 3,
    authConfig?: AuthConfig,
    outputDir?: string,
    options?: { workflowState?: WorkflowStateGraph; sessionPool?: SessionPool; authFlow?: AuthFlow; envCreds?: Record<string, Record<string, string>> },
  ): Promise<CrawlResult> {
    const startTime = Date.now();
    const baseUrl = new URL(targetUrl).origin;
    const visited = new Set<string>();
    const routes: RouteNode[] = [];
    const errors: Array<{ url: string; error: string }> = [];
    const snapshots: DOMSnapshot[] = [];
    const aggregatedCookies: Record<string, string> = {};
    const aggregatedLocalStorage: Record<string, string> = {};
    const aggregatedSessionStorage: Record<string, string> = {};
    const techHints = new Set<string>();
    let queue: Array<{ url: string; depth: number }> = [{ url: this.normalize(targetUrl), depth: 0 }];
    let storageStatePath = '';
    let loginEndpoint = '';
    let loginMethod = '';
    const loginFields: string[] = [];
    const workflowState = options?.workflowState;
    const sessionPool = options?.sessionPool;
    const authFlow = options?.authFlow;
    const envCreds = options?.envCreds;

    // Start trace + recording
    await this.manager.startTrace(this.sessionId);
    this.manager.startRecording(this.sessionId);

    while (queue.length > 0 && routes.length < MAX_PAGES) {
      const { url, depth } = queue.shift()!;
      if (depth > maxDepth || visited.has(url)) continue;
      visited.add(url);

      try {
        const finalUrl = await this.manager.navigate(this.sessionId, url, { relaxed: true });
        const page = await this.manager.getOrCreate(this.sessionId);

        // Take full DOM snapshot — replaces manual form counting + link extraction
        const snapshot = await takeSnapshotDeep(page);
        snapshots.push(snapshot);

        // Capture body preview + content type + status for the LLM planner
        const captureMeta: { bodyPreview: string; contentType: string; status: number } = await page.evaluate(() => {
          const doc = (globalThis as any).document;
          const fullText = doc?.body?.innerText || '';
          return {
            bodyPreview: fullText.slice(0, 1500),
            contentType: (doc?.contentType || '') as string,
            status: 200,
          };
        }).catch(() => ({ bodyPreview: '', contentType: '', status: 0 }));

        const links: Array<{ href: string; text: string }> = await page.evaluate(() =>
          Array.from(document.querySelectorAll('a[href]')).map((a) => ({
            href: (a as HTMLAnchorElement).getAttribute('href') || '',
            text: ((a as HTMLAnchorElement).textContent || '').trim().slice(0, 60),
          }))
        );
        const resolvedLinks = this.resolveLinks(links, finalUrl, baseUrl);

        // Extract iframe src URLs as discoverable routes
        const iframeSrcs = snapshot.iframes.map(ifr => ifr.src);
        for (const src of iframeSrcs) {
          try {
            const absUrl = new URL(src, finalUrl).href;
            if (!visited.has(absUrl) && !queue.some(q => q.url === absUrl)) {
              queue.push({ url: absUrl, depth: depth + 1 });
            }
          } catch { /* ignore invalid iframe src */ }
        }

        routes.push({
          path: new URL(finalUrl).pathname,
          title: snapshot.title || '(no title)',
          depth,
          url: finalUrl,
          forms: snapshot.forms.length,
          linkCount: resolvedLinks.length,
          visitedAt: Date.now(),
          bodyPreview: captureMeta.bodyPreview,
          contentType: captureMeta.contentType,
          status: captureMeta.status,
        });

        if (workflowState) {
          const isAuth = /\/(login|signin|admin|account|profile|me|dashboard|user)/i.test(finalUrl);
          const isApi = /\/api\//.test(finalUrl);
          const isLoginPage = this.isAuthForm(snapshot.forms) || /\/(login|signin)/i.test(finalUrl);
          const nodeType: 'page' | 'api' | 'login' = isLoginPage ? 'login' : isApi ? 'api' : 'page';
          const nodeId = workflowState.generateId(nodeType === 'login' ? 'login' : nodeType === 'api' ? 'api' : 'page');
          const node = workflowState.addNode({
            id: nodeId,
            url: finalUrl,
            title: snapshot.title || '(no title)',
            type: nodeType,
            authRequired: isAuth || isLoginPage,
            authVerified: isLoginPage && aggregatedCookies && Object.keys(aggregatedCookies).length > 0,
            discoveredFrom: null,
            discoveryMethod: 'navigation',
            status: nodeType === 'login' ? 'reachable' : 'reachable',
          });
          if (depth === 0) {
            // first page — keep reachable but no parent
          } else if (routes.length > 1) {
            const prevId = routes[routes.length - 2] ? workflowState.getNode(`page-${(routes.length - 1).toString(36)}`)?.id : null;
            // edge from previous to current — try to find prev by URL match
            const prevNodes = workflowState.getNodes().filter((n) => n.url !== finalUrl);
            const last = prevNodes[prevNodes.length - 1];
            if (last) workflowState.addEdge({ fromId: last.id, toId: nodeId, trigger: 'navigation', label: 'crawl' });
          }
          void node; // suppress unused warning
        }

        // Capture cookies from browser context
        const ctxCookies = await page.context().cookies();
        for (const c of ctxCookies) {
          aggregatedCookies[c.name] = c.value;
        }

        // Capture localStorage
        const ls = await page.evaluate(() => {
          const items: Record<string, string> = {};
          for (let i = 0; i < localStorage.length; i++) {
            const k = localStorage.key(i);
            if (k) items[k] = localStorage.getItem(k) || '';
          }
          return items;
        });
        Object.assign(aggregatedLocalStorage, ls);

        // Capture sessionStorage
        const ss = await page.evaluate(() => {
          const items: Record<string, string> = {};
          for (let i = 0; i < sessionStorage.length; i++) {
            const k = sessionStorage.key(i);
            if (k) items[k] = sessionStorage.getItem(k) || '';
          }
          return items;
        });
        Object.assign(aggregatedSessionStorage, ss);

        // Detect tech stack from DOM
        const domTech = await page.evaluate(() => {
          const hints: string[] = [];
          const metaGenerator = document.querySelector('meta[name="generator"]');
          if (metaGenerator) hints.push(metaGenerator.getAttribute('content') || '');

          if (typeof (window as any).__NEXT_DATA__ !== 'undefined') hints.push('Next.js');
          if (typeof (window as any).__NUXT__ !== 'undefined') hints.push('Nuxt.js');
          if (typeof (window as any).React !== 'undefined') hints.push('React');
          if (typeof (window as any).Vue !== 'undefined') hints.push('Vue.js');
          if (typeof (window as any).angular !== 'undefined') hints.push('Angular');
          if (typeof (window as any).jQuery !== 'undefined') hints.push('jQuery');

          document.querySelectorAll('script[src]').forEach((s) => {
            const src = (s as HTMLScriptElement).src.toLowerCase();
            if (src.includes('react')) hints.push('React');
            if (src.includes('vue')) hints.push('Vue.js');
            if (src.includes('angular')) hints.push('Angular');
            if (src.includes('jquery')) hints.push('jQuery');
            if (src.includes('next')) hints.push('Next.js');
            if (src.includes('nuxt')) hints.push('Nuxt.js');
            if (src.includes('svelte')) hints.push('Svelte');
            if (src.includes('ember')) hints.push('Ember.js');
            if (src.includes('backbone')) hints.push('Backbone.js');
            if (src.includes('django')) hints.push('Django');
            if (src.includes('laravel')) hints.push('Laravel');
          });

          return hints;
        });
        for (const h of domTech) techHints.add(h);

        // Enqueue unvisited same-origin children
        for (const link of resolvedLinks) {
          if (!visited.has(link) && depth + 1 <= maxDepth) {
            queue.push({ url: link, depth: depth + 1 });
          }
        }

        // Phase 2A: Dismiss dialogs and overlays (cookie banners, modals, popups)
        if (snapshot.dialogs.length > 0 || snapshot.overlays.length > 0) {
          await this.dismissOverlays(page, snapshot, snapshots);
        }

        // Phase 2B: Click interactive elements (buttons, toggles, tabs) to reveal hidden content
        if (snapshot.interactive.length > 0) {
          await this.clickInteractiveElements(page, snapshot, finalUrl, visited, queue, depth, snapshots, maxDepth);
        }

        // Phase 2C: Explore forms — fill, submit, capture result pages
        if (snapshot.forms.length > 0) {
          await this.exploreFormsOnPage(page, snapshot.forms, finalUrl, visited, queue, depth, snapshots, maxDepth);
        }

        // Phase 2D: Explore standalone inputs outside forms (search bars, inline editors, SPAs)
        if (snapshot.inputs.length > 0) {
          await this.exploreStandaloneInputs(page, snapshot.inputs, finalUrl, visited, queue, depth, snapshots, maxDepth);
        }

        // Phase 3: Extract SPA hash routes from links and enqueue them
        const spaRoutes = this.extractHashRoutes(links, finalUrl, baseUrl);
        for (const route of spaRoutes) {
          if (!visited.has(route) && depth + 1 <= maxDepth) {
            queue.push({ url: route, depth: depth + 1 });
          }
        }

        // Phase 4: Detect auth forms and attempt login
        if (snapshot.forms.length > 0 && this.isAuthForm(snapshot.forms)) {
          if (authConfig) {
            await this.attemptAuthFlow(page, snapshot, finalUrl, visited, queue, depth, snapshots, maxDepth, authConfig);
          }
          // Even without creds, note the login endpoint for LLM-guided auth
          const authForm = snapshot.forms.find((f) => {
            const types = f.fields.map((fd) => fd.type.toLowerCase());
            return types.includes('password');
          });
          if (authForm && !loginEndpoint) {
            try {
              loginEndpoint = new URL(authForm.action, finalUrl).href;
            } catch { loginEndpoint = authForm.action || finalUrl; }
            loginMethod = authForm.method.toUpperCase();
            for (const f of authForm.fields || []) {
              if (f.name) loginFields.push(f.name);
            }
          }
        }

        // Export storage state if browser now has session cookies
        if (!storageStatePath && outputDir) {
          try {
            const ctxCookies = await page.context().cookies();
            const hasSession = ctxCookies.some(
              (c) => /session|token|auth|sid|jwt|connect\.sid|phpsessid|jsessionid/i.test(c.name)
            );
            if (hasSession) {
              const state = await page.context().storageState();
              const authDir = path.join(outputDir, '.auth');
              fs.mkdirSync(authDir, { recursive: true });
              const ssFile = path.join(authDir, 'storage-state.json');
              fs.writeFileSync(ssFile, JSON.stringify(state, null, 2));
              storageStatePath = ssFile;
            }
          } catch {}
        }
      } catch (err) {
        errors.push({ url, error: String(err) });
      }
    }

    // Detect tech stack from trace response headers
    const spiderTrace = this.manager.stopTrace(this.sessionId);
    for (const entry of spiderTrace) {
      const headers = entry.responseHeaders || {};
      const server = (headers['server'] || '').toLowerCase();
      const poweredBy = (headers['x-powered-by'] || headers['x-powered-by'] || '').toLowerCase();
      const setCookie = (headers['set-cookie'] || '').toLowerCase();
      if (server.includes('express') || poweredBy.includes('express')) techHints.add('Express.js');
      if (server.includes('nginx')) techHints.add('Nginx');
      if (server.includes('apache')) techHints.add('Apache');
      if (server.includes('cloudflare')) techHints.add('Cloudflare');
      if (poweredBy.includes('asp.net')) techHints.add('ASP.NET');
      if (poweredBy.includes('php')) techHints.add('PHP');
      if (poweredBy.includes('flask') || poweredBy.includes('python')) techHints.add('Flask/Python');
      if (poweredBy.includes('django')) techHints.add('Django');
      if (poweredBy.includes('next.js') || poweredBy.includes('nextjs')) techHints.add('Next.js');
      if (setCookie.includes('sessionid=')) techHints.add('Django');
      if (setCookie.includes('jsessionid=')) techHints.add('Java EE');
      if (setCookie.includes('phpsessid')) techHints.add('PHP');
      if (setCookie.includes('.aspnetcore')) techHints.add('ASP.NET Core');
    }

    const spiderRecording = this.manager.stopRecording(this.sessionId);

    if (authFlow && sessionPool) {
      try {
        const page = await this.manager.getOrCreate(this.sessionId);
        const pageText = await page.evaluate(() => (globalThis as any).document?.body?.innerText || '').catch(() => '');
        const navLinks = await page.evaluate(() =>
          Array.from((globalThis as any).document?.querySelectorAll('a[href]') || []).map((a: any) => a.getAttribute('href') || ''),
        ).catch(() => []);
        const formActions = snapshots.flatMap((s) => s.forms.map((f) => f.action));
        await authFlow.discoverAndPopulate(page, baseUrl, { pageText, formActions, navLinks });
      } catch (e) {
        errors.push({ url: '<auth-flow>', error: `auth flow failed: ${String(e)}` });
      }
    }

    return {
      baseUrl,
      totalRoutes: routes.length,
      maxDepth,
      durationMs: Date.now() - startTime,
      routes,
      visitedUrls: Array.from(visited),
      errors,
      trace: spiderTrace,
      recording: spiderRecording,
      snapshots,
      cookies: aggregatedCookies,
      localStorage: aggregatedLocalStorage,
      sessionStorage: aggregatedSessionStorage,
      techStack: Array.from(techHints),
      storageStatePath,
      loginEndpoint,
      loginMethod,
      loginFields,
    };
  }

  private normalize(url: string): string {
    try {
      const u = new URL(url);
      return u.origin + u.pathname.replace(/\/$/, '') || u.origin + '/';
    } catch {
      return url;
    }
  }

  private resolveLinks(
    links: Array<{ href: string; text: string }>,
    currentUrl: string,
    baseOrigin: string,
  ): string[] {
    const resolved: string[] = [];
    for (const { href } of links) {
      try {
        const abs = new URL(href, currentUrl);
        if (abs.origin !== baseOrigin) continue;
        if (STATIC_EXT.test(abs.pathname)) continue;
        if (SKIP_PREFIXES.some((p) => href.startsWith(p))) continue;
        const normalized = abs.origin + abs.pathname.replace(/\/$/, '') || abs.origin + '/';
        if (normalized !== abs.origin + '/') resolved.push(normalized);
      } catch {
        // skip malformed URLs
      }
    }
    return [...new Set(resolved)];
  }

  private guessFieldValue(field: { name: string; type: string; placeholder: string; required: boolean }, domain: string): string | null {
    const name = field.name.toLowerCase();
    const type = field.type.toLowerCase();
    const placeholder = field.placeholder.toLowerCase();

    if (['hidden', 'file', 'submit', 'button', 'image', 'reset'].includes(type)) return null;
    if (type === 'date') return new Date().toISOString().slice(0, 10);
    if (type === 'datetime-local') return new Date().toISOString().slice(0, 16);
    if (['number', 'range'].includes(type)) return '1';
    if (type === 'email' || name.includes('email') || placeholder.includes('email')) return `test@${domain}`;
    if (type === 'password' || name.includes('password') || placeholder.includes('password'))
      return `T${Math.random().toString(36).slice(2, 6)}${Math.random().toString(36).slice(2, 6)}!`;
    if (['tel', 'phone'].includes(type) || name.includes('phone') || name.includes('tel') || placeholder.includes('phone'))
      return `+1${String(Date.now()).slice(-10)}`;
    if (type === 'url' || name.includes('url') || name.includes('website') || placeholder.includes('url'))
      return `https://${domain}/`;
    if (type === 'search' || name === 'q' || name === 's' || name === 'search' || placeholder.includes('search')) return 'test';
    if (name.includes('name') || placeholder.includes('name') || placeholder.includes('full name')) return 'tester';
    if (name.includes('user') || name.includes('login') || placeholder.includes('username'))
      return `user_${Math.random().toString(36).slice(2, 8)}`;
    if (name.includes('comment') || name.includes('message') || placeholder.includes('comment') || placeholder.includes('message'))
      return `test ${domain} security scan`;
    if (type === 'textarea') return `test content for ${domain}`;
    if (type === 'color') return '#cc0000';
    if (type === 'month') return `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, '0')}`;
    if (type === 'week') return `${new Date().getFullYear()}-W${String(Math.ceil((new Date().getTime() - new Date(new Date().getFullYear(), 0, 1).getTime()) / 604800000)).padStart(2, '0')}`;
    if (type === 'time') return `${String(new Date().getHours()).padStart(2, '0')}:${String(new Date().getMinutes()).padStart(2, '0')}`;

    return `${domain}_test`;
  }

  private async exploreFormsOnPage(
    page: Page,
    forms: DOMSnapshot['forms'],
    currentUrl: string,
    visited: Set<string>,
    queue: Array<{ url: string; depth: number }>,
    depth: number,
    snapshots: DOMSnapshot[],
    maxDepth: number,
  ): Promise<void> {
    const baseUrl = new URL(currentUrl).origin;
    const domain = new URL(currentUrl).hostname;

    for (const form of forms) {
      if (form.fields.length === 0) continue;

      let absAction: string;
      try {
        absAction = new URL(form.action || '', currentUrl).href;
      } catch {
        continue;
      }
      if (visited.has(absAction) || STATIC_EXT.test(absAction)) continue;
      if (SKIP_PREFIXES.some((p) => absAction.startsWith(p))) continue;

      const formSelector = form.selector;

      try {
        // Fill text-like fields
        for (const field of form.fields) {
          const value = this.guessFieldValue(field, domain);
          if (value === null) continue;

          const fType = field.type.toLowerCase();
          if (fType === 'checkbox' || fType === 'radio') {
            await page.check(`${formSelector} [name="${field.name}"]`).catch(() => {});
            continue;
          }
          if (fType === 'select-one' || fType === 'select-multiple') {
            const opts = await page.$$eval(`${formSelector} [name="${field.name}"] option`, (els) =>
              els.map((o) => (o as HTMLOptionElement).value).filter(Boolean),
            );
            if (opts.length > 0) {
              await page.selectOption(`${formSelector} [name="${field.name}"]`, opts[0]);
            }
            continue;
          }

          await this.manager.fill(this.sessionId, `${formSelector} [name="${field.name}"]`, value);
        }

        // Find submit button
        const submitSelector = `${formSelector} button[type="submit"], ${formSelector} input[type="submit"], ${formSelector} button:not([type])`;
        const hasSubmitBtn = await page.$(submitSelector);

        // Submit — race navigation vs timeout
        let navigated = false;
        let newUrl = currentUrl;

        try {
          await Promise.all([
            page.waitForURL((u) => u.href !== currentUrl, { timeout: 8000 }),
            hasSubmitBtn
              ? this.manager.click(this.sessionId, submitSelector)
              : page.keyboard.press('Enter'),
          ]);
          navigated = true;
          newUrl = page.url();
        } catch {
          await page.waitForTimeout(2000);
          newUrl = page.url();
        }

        // Process result page
        if (navigated && newUrl !== currentUrl) {
          if (!visited.has(newUrl) && !STATIC_EXT.test(newUrl)) {
            const resultSnapshot = await takeSnapshotDeep(page);
            snapshots.push(resultSnapshot);

            const links: Array<{ href: string; text: string }> = await page.evaluate(() =>
              Array.from(document.querySelectorAll('a[href]')).map((a) => ({
                href: (a as HTMLAnchorElement).getAttribute('href') || '',
                text: ((a as HTMLAnchorElement).textContent || '').trim().slice(0, 60),
              })),
            );
            const resolved = this.resolveLinks(links, newUrl, baseUrl);
            visited.add(newUrl);
            for (const link of resolved) {
              if (!visited.has(link) && depth + 1 <= maxDepth) {
                queue.push({ url: link, depth: depth + 1 });
              }
            }
          }
        } else {
          const afterSnapshot = await takeSnapshotDeep(page);
          if (snapshots.length > 0 && !isSamePage(snapshots[snapshots.length - 1], afterSnapshot)) {
            snapshots.push(afterSnapshot);

            const links: Array<{ href: string; text: string }> = await page.evaluate(() =>
              Array.from(document.querySelectorAll('a[href]')).map((a) => ({
                href: (a as HTMLAnchorElement).getAttribute('href') || '',
                text: ((a as HTMLAnchorElement).textContent || '').trim().slice(0, 60),
              })),
            );
            const resolved = this.resolveLinks(links, newUrl, baseUrl);
            for (const link of resolved) {
              if (!visited.has(link) && depth + 1 <= maxDepth) {
                queue.push({ url: link, depth: depth + 1 });
              }
            }
          }
        }

        // Navigate back to original page if needed
        if (page.url() !== currentUrl) {
          await page.goto(currentUrl, { waitUntil: 'domcontentloaded' });
        }
      } catch {
        try {
          if (page.url() !== currentUrl) {
            await page.goto(currentUrl, { waitUntil: 'domcontentloaded' });
          }
        } catch {}
      }
    }
  }

  private async exploreStandaloneInputs(
    page: Page,
    inputs: DOMSnapshot['inputs'],
    currentUrl: string,
    visited: Set<string>,
    queue: Array<{ url: string; depth: number }>,
    depth: number,
    snapshots: DOMSnapshot[],
    maxDepth: number,
  ): Promise<void> {
    const baseUrl = new URL(currentUrl).origin;
    const domain = new URL(currentUrl).hostname;

    for (const input of inputs) {
      try {
        const value = this.guessFieldValue(
          { name: input.name, type: input.type, placeholder: input.placeholder, required: false },
          domain,
        );
        if (value === null) continue;

        await this.manager.fill(this.sessionId, input.selector, value);

        // Submit: click nearby button or press Enter
        let navigated = false;
        try {
          await Promise.all([
            page.waitForURL((u) => u.href !== currentUrl, { timeout: 8000 }),
            input.nearButton
              ? this.manager.click(this.sessionId, input.nearButton)
              : page.keyboard.press('Enter'),
          ]);
          navigated = true;
        } catch {
          await page.waitForTimeout(2000);
        }

        const newUrl = page.url();

        // If navigation happened and URL has query params, discover real param names
        if (navigated && newUrl !== currentUrl) {
          const resultUrl = new URL(newUrl);
          const discoveredParams: string[] = [];
          resultUrl.searchParams.forEach((v, k) => {
            if (v === value) discoveredParams.push(k);
          });
          if (discoveredParams.length > 0) {
            input.resolvedParam = discoveredParams[0];
          } else if (resultUrl.searchParams.size > 0) {
            // Fallback: use first param even if value doesn't match (encoding/transformation)
            input.resolvedParam = resultUrl.searchParams.keys().next().value;
          }

          // Capture the result page as a parameterized endpoint
          if (!visited.has(newUrl) && !STATIC_EXT.test(newUrl)) {
            const resultSnapshot = await takeSnapshotDeep(page);
            snapshots.push(resultSnapshot);

            const links: Array<{ href: string; text: string }> = await page.evaluate(() =>
              Array.from(document.querySelectorAll('a[href]')).map((a) => ({
                href: (a as HTMLAnchorElement).getAttribute('href') || '',
                text: ((a as HTMLAnchorElement).textContent || '').trim().slice(0, 60),
              })),
            );
            const resolved = this.resolveLinks(links, newUrl, baseUrl);
            visited.add(newUrl);
            for (const link of resolved) {
              if (!visited.has(link) && depth + 1 <= maxDepth) {
                queue.push({ url: link, depth: depth + 1 });
              }
            }
          }
        } else {
          // No navigation — DOM might have changed (AJAX)
          const afterSnapshot = await takeSnapshotDeep(page);
          if (snapshots.length > 0 && !isSamePage(snapshots[snapshots.length - 1], afterSnapshot)) {
            snapshots.push(afterSnapshot);
          }
        }
      } catch {
        // Best effort — don't fail the crawl for one input
      }

      // Navigate back to continue crawl
      try {
        if (page.url() !== currentUrl) {
          await page.goto(currentUrl, { waitUntil: 'domcontentloaded' });
        }
      } catch {}
    }
  }

  private async dismissOverlays(
    page: Page,
    snapshot: DOMSnapshot,
    snapshots: DOMSnapshot[],
  ): Promise<void> {
    for (const dialog of snapshot.dialogs) {
      if (!dialog.isVisible) continue;
      try {
        const btn = await page.$(
          `${dialog.selector} button, ${dialog.selector} a[href], ${dialog.selector} [role="button"]`,
        );
        if (btn) {
          await btn.click().catch(() => {});
          await page.waitForTimeout(1000);
          const after = await takeSnapshotDeep(page);
          if (!isSamePage(snapshot, after)) snapshots.push(after);
        }
      } catch {}
    }
    for (const overlay of snapshot.overlays) {
      try {
        const btn = await page.$(
          `${overlay.selector} button, ${overlay.selector} a, ${overlay.selector} [class*="close"], ${overlay.selector} [class*="dismiss"]`,
        );
        if (btn) {
          await btn.click().catch(() => {});
          await page.waitForTimeout(1000);
          const after = await takeSnapshotDeep(page);
          if (!isSamePage(snapshot, after)) snapshots.push(after);
        }
      } catch {}
    }
  }

  private async clickInteractiveElements(
    page: Page,
    snapshot: DOMSnapshot,
    currentUrl: string,
    visited: Set<string>,
    queue: Array<{ url: string; depth: number }>,
    depth: number,
    snapshots: DOMSnapshot[],
    maxDepth: number,
  ): Promise<void> {
    const DANGER_WORDS = /logout|sign.?out|delete|remove|destroy|terminate|cancel|revoke|deactivate/i;
    const baseUrl = new URL(currentUrl).origin;

    for (const el of snapshot.interactive) {
      if (DANGER_WORDS.test(el.text)) continue;
      if (el.tag === 'a' && el.href) continue;

      try {
        const beforeUrl = page.url();
        const btn = await page.$(el.selector);
        if (!btn) continue;

        await btn.click();
        let navigated = false;
        try {
          await page.waitForURL((u) => u.href !== beforeUrl, { timeout: 5000 });
          navigated = true;
        } catch {
          await page.waitForTimeout(1500);
        }

        const newUrl = page.url();
        if (navigated && newUrl !== currentUrl) {
          if (!visited.has(newUrl) && !STATIC_EXT.test(newUrl)) {
            const resultSnapshot = await takeSnapshotDeep(page);
            snapshots.push(resultSnapshot);
            const links = await page.evaluate(() =>
              Array.from(document.querySelectorAll('a[href]')).map((a) => ({
                href: (a as HTMLAnchorElement).getAttribute('href') || '',
                text: ((a as HTMLAnchorElement).textContent || '').trim().slice(0, 60),
              })),
            );
            const resolved = this.resolveLinks(links, newUrl, baseUrl);
            visited.add(newUrl);
            for (const link of resolved) {
              if (!visited.has(link) && depth + 1 <= maxDepth) queue.push({ url: link, depth: depth + 1 });
            }
          }
        } else {
          const after = await takeSnapshotDeep(page);
          if (snapshots.length > 0 && !isSamePage(snapshots[snapshots.length - 1], after)) {
            snapshots.push(after);
            const links = await page.evaluate(() =>
              Array.from(document.querySelectorAll('a[href]')).map((a) => ({
                href: (a as HTMLAnchorElement).getAttribute('href') || '',
                text: ((a as HTMLAnchorElement).textContent || '').trim().slice(0, 60),
              })),
            );
            const resolved = this.resolveLinks(links, newUrl, baseUrl);
            for (const link of resolved) {
              if (!visited.has(link) && depth + 1 <= maxDepth) queue.push({ url: link, depth: depth + 1 });
            }
          }
        }

        if (page.url() !== currentUrl) {
          await page.goto(currentUrl, { waitUntil: 'domcontentloaded' });
        }
      } catch {}
    }
  }

  private extractHashRoutes(
    links: Array<{ href: string; text: string }>,
    currentUrl: string,
    baseOrigin: string,
  ): string[] {
    const routes: string[] = [];
    for (const { href } of links) {
      if (!href.startsWith('#') && !href.startsWith('/#')) continue;
      try {
        const abs = new URL(href, currentUrl);
        if (abs.origin !== baseOrigin) continue;
        const hash = abs.hash;
        if (!hash || hash === '#' || hash === '#/') continue;
        if (STATIC_EXT.test(hash)) continue;
        routes.push(abs.href);
      } catch {}
    }
    return [...new Set(routes)];
  }

  private isAuthForm(forms: DOMSnapshot['forms']): boolean {
    return forms.some((f) => {
      const names = f.fields.map((fd) => fd.name.toLowerCase());
      const types = f.fields.map((fd) => fd.type.toLowerCase());
      const hasPassword = types.includes('password');
      const hasUsername = names.some((n) => /user|login|email/.test(n)) || types.includes('email');
      return hasPassword && hasUsername;
    });
  }

  private async attemptAuthFlow(
    page: Page,
    snapshot: DOMSnapshot,
    currentUrl: string,
    visited: Set<string>,
    queue: Array<{ url: string; depth: number }>,
    depth: number,
    snapshots: DOMSnapshot[],
    maxDepth: number,
    authConfig: AuthConfig,
  ): Promise<void> {
    const authForm = snapshot.forms.find((f) => {
      const names = f.fields.map((fd) => fd.name.toLowerCase());
      const types = f.fields.map((fd) => fd.type.toLowerCase());
      return types.includes('password') && (names.some((n) => /user|login|email/.test(n)) || types.includes('email'));
    });
    if (!authForm) return;

    const formSelector = authForm.selector;
    try {
      for (const field of authForm.fields) {
        const name = field.name.toLowerCase();
        const type = field.type.toLowerCase();
        if (type === 'password') {
          await this.manager.fill(this.sessionId, `${formSelector} [name="${field.name}"]`, authConfig.password);
        } else if (type === 'email' || name.includes('email') || name.includes('user') || name.includes('login')) {
          await this.manager.fill(this.sessionId, `${formSelector} [name="${field.name}"]`, authConfig.username);
        }
      }

      const submitSel = `${formSelector} button[type="submit"], ${formSelector} input[type="submit"], ${formSelector} button:not([type])`;
      const hasSubmit = await page.$(submitSel);

      let navigated = false;
      try {
        await Promise.all([
          page.waitForURL((u) => u.href !== currentUrl, { timeout: 8000 }),
          hasSubmit ? this.manager.click(this.sessionId, submitSel) : page.keyboard.press('Enter'),
        ]);
        navigated = true;
      } catch {
        await page.waitForTimeout(2000);
      }

      if (!navigated) return;

      const newUrl = page.url();
      if (!visited.has(newUrl) && !STATIC_EXT.test(newUrl)) {
        const resultSnapshot = await takeSnapshotDeep(page);
        snapshots.push(resultSnapshot);
        visited.add(newUrl);
        const baseUrl = new URL(currentUrl).origin;
        const links = await page.evaluate(() =>
          Array.from(document.querySelectorAll('a[href]')).map((a) => ({
            href: (a as HTMLAnchorElement).getAttribute('href') || '',
            text: ((a as HTMLAnchorElement).textContent || '').trim().slice(0, 60),
          })),
        );
        const resolved = this.resolveLinks(links, newUrl, baseUrl);
        for (const link of resolved) {
          if (!visited.has(link) && depth + 1 <= maxDepth) queue.push({ url: link, depth: depth + 1 });
        }
      }
    } catch {}
  }

  async close(): Promise<string> {
    const entries = this.manager.getTrace(this.sessionId);
    const navs = entries.filter((e) => e.type === 'navigation').length;
    const apis = entries.filter((e) => e.type === 'xhr' || e.type === 'fetch').length;
    await this.manager.close(this.sessionId);
    return `Spider session closed. Recorded ${navs} navigations, ${apis} API calls.`;
  }
}
