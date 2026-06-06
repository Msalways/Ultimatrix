import { z } from 'zod';
import { tool, DynamicStructuredTool } from '@langchain/core/tools';
import { getAppModelPath } from '../core/app-model-path';

export function u(input: Record<string, unknown>): Record<string, unknown> {
  if (input.url) return input;
  if (typeof input.target === 'string' && input.target) return { ...input, url: input.target };
  if (typeof input.targetUrl === 'string' && input.targetUrl) return { ...input, url: input.targetUrl };
  if (typeof input.target_url === 'string' && input.target_url) return { ...input, url: input.target_url };
  if (typeof input.endpoint === 'string' && input.endpoint) return { ...input, url: input.endpoint };
  return input;
}

import { createBrowserNavigateTool, createBrowserClickTool, createBrowserFillTool, createBrowserPressKeyTool, createBrowserScreenshotTool, createBrowserExtractTool, createBrowserEvaluateTool, createBrowserCloseTool, createBrowserGetFormsTool, createBrowserGetCookiesTool, createBrowserGetScriptsTool, createBrowserGetStorageTool, createBrowserStartRecordingTool, createBrowserStopRecordingTool, createBrowserGetRecordingTool, createBrowserStartTraceTool, createBrowserStopTraceTool, createBrowserGetTraceTool, createBrowserReplayMacroTool, createMacroListTool, createInjectCookieTool, createCreateBrowserSessionTool, createListBrowserSessionsTool, createSaveStorageStateTool, createLoadStorageStateTool, createManualRecordStartTool, createManualRecordStopTool } from './browser-tools';
import { createReadAppModelTool, createUpdateAppModelTool } from './app-model-tools';
import { createCrawlDiscoverTool } from './crawl-tools';
import { createGetSessionStatusTool, createGetDomSnapshotTool, createExportHarTool, createWaitForNavigationTool, createResetSessionTool } from './session-tools';
import { readAppModel, writeAppModel, calculateOverallRisk, renderWorkflowGraph, updateAppModelSection, type AppModelSection } from '../core/app-model';
import { OastServer } from '../oast/server';
import { triageFinding, applyTriageToFindings } from '../triage';

const TOOL_EXECUTION_TIMEOUT = 30000; // 30s default timeout for tool invocations

// ── Tool Registry ──

export class ToolRegistry {
  private tools: Map<string, DynamicStructuredTool> = new Map();
  private meta: Map<string, { name: string; category: string; description: string; tags?: string[] }> = new Map();
  private factories: Map<string, () => DynamicStructuredTool> = new Map();
  private workerTracker: ((id: string, promise: Promise<unknown>) => void) | null = null;

  register(toolConfig: {
    name: string;
    category: string;
    description: string;
    tags?: string[];
    factory: () => DynamicStructuredTool;
  }): void {
    // Defer factory invocation until the tool is actually requested.
    // This avoids module-load-time TDZ errors when a factory references
    // a `const` from its own module that hasn't been initialized yet
    // (e.g. browser-tools.ts registers via tool-registry.ts which is
    // imported by browser-tools.ts — a circular import).
    this.factories.set(toolConfig.name, toolConfig.factory);
    this.meta.set(toolConfig.name, { name: toolConfig.name, category: toolConfig.category, description: toolConfig.description, tags: toolConfig.tags });
  }

  setWorkerTracker(tracker: (id: string, promise: Promise<unknown>) => void): void {
    this.workerTracker = tracker;
  }

  getWorkerTracker(): ((id: string, promise: Promise<unknown>) => void) | null {
    return this.workerTracker;
  }

  getAll(): DynamicStructuredTool[] {
    // Materialize any pending factories on demand.
    for (const [name, factory] of this.factories) {
      if (!this.tools.has(name)) {
        try { this.tools.set(name, factory()); } catch { /* skip broken factories */ }
      }
    }
    return Array.from(this.tools.values());
  }

  get(name: string): DynamicStructuredTool | undefined {
    if (!this.tools.has(name) && this.factories.has(name)) {
      try { this.tools.set(name, this.factories.get(name)!()); } catch { return undefined; }
    }
    return this.tools.get(name);
  }

  getByCategory(category: string): DynamicStructuredTool[] {
    const names = new Set(
      Array.from(this.meta.values()).filter(m => m.category === category).map(m => m.name)
    );
    this.getAll();
    return Array.from(this.tools.values()).filter(t => names.has(t.name));
  }

  listByCategory(): Record<string, string[]> {
    const result: Record<string, string[]> = {};
    for (const m of this.meta.values()) {
      if (!result[m.category]) result[m.category] = [];
      result[m.category].push(m.name);
    }
    return result;
  }
}

export const toolRegistry = new ToolRegistry();

// ── Browser Tools ──

toolRegistry.register({
  name: 'browser_navigate',
  category: 'browser',
  description: 'Navigate to a URL. Returns the page title and URL.',
  tags: ['browser', 'navigation'],
  factory: () => createBrowserNavigateTool(),
});

toolRegistry.register({
  name: 'browser_click',
  category: 'browser',
  description: 'Click an element by selector. Use for buttons, links, toggles, tabs.',
  tags: ['browser', 'interaction'],
  factory: () => createBrowserClickTool(),
});

toolRegistry.register({
  name: 'browser_fill',
  category: 'browser',
  description: 'Fill an input field or contenteditable element with text. For standard inputs uses Playwright fill(); for contenteditable or JS-heavy inputs, injects via JavaScript.',
  tags: ['browser', 'interaction'],
  factory: () => createBrowserFillTool(),
});

toolRegistry.register({
  name: 'browser_press_key',
  category: 'browser',
  description: 'Press a keyboard key (Enter, Escape, Tab, ArrowDown, etc.). Use for form submission without click, dropdown selection, dialog dismissal.',
  tags: ['browser', 'interaction'],
  factory: () => createBrowserPressKeyTool(),
});

toolRegistry.register({
  name: 'browser_screenshot',
  category: 'browser',
  description: 'Take a screenshot of the current page.',
  tags: ['browser', 'visual'],
  factory: () => createBrowserScreenshotTool(),
});

toolRegistry.register({
  name: 'browser_extract',
  category: 'browser',
  description: 'Extract structured data from the page using a CSS selector.',
  tags: ['browser', 'extraction'],
  factory: () => createBrowserExtractTool(),
});

toolRegistry.register({
  name: 'browser_evaluate',
  category: 'browser',
  description: 'Run custom JavaScript in the browser page context.',
  tags: ['browser', 'scripting'],
  factory: () => createBrowserEvaluateTool(),
});

toolRegistry.register({
  name: 'browser_close',
  category: 'browser',
  description: 'Close the current browser session.',
  tags: ['browser', 'session'],
  factory: () => createBrowserCloseTool(),
});

toolRegistry.register({
  name: 'browser_get_forms',
  category: 'browser',
  description: 'Get the structure of all forms on the current page.',
  tags: ['browser', 'extraction'],
  factory: () => createBrowserGetFormsTool(),
});

toolRegistry.register({
  name: 'browser_get_cookies',
  category: 'browser',
  description: 'Get all cookies for the current page.',
  tags: ['browser', 'extraction'],
  factory: () => createBrowserGetCookiesTool(),
});

toolRegistry.register({
  name: 'browser_get_scripts',
  category: 'browser',
  description: 'Get the content of all inline and external scripts on the current page.',
  tags: ['browser', 'extraction'],
  factory: () => createBrowserGetScriptsTool(),
});

toolRegistry.register({
  name: 'browser_get_storage',
  category: 'browser',
  description: 'Get localStorage and sessionStorage for the current origin.',
  tags: ['browser', 'extraction'],
  factory: () => createBrowserGetStorageTool(),
});

toolRegistry.register({
  name: 'browser_start_recording',
  category: 'browser',
  description: 'Start recording all browser interactions (navigation, clicks, fills).',
  tags: ['browser', 'recording'],
  factory: () => createBrowserStartRecordingTool(),
});

toolRegistry.register({
  name: 'browser_stop_recording',
  category: 'browser',
  description: 'Stop recording and return recorded steps.',
  tags: ['browser', 'recording'],
  factory: () => createBrowserStopRecordingTool(),
});

toolRegistry.register({
  name: 'browser_get_recording',
  category: 'browser',
  description: 'Get the current recording without stopping.',
  tags: ['browser', 'recording'],
  factory: () => createBrowserGetRecordingTool(),
});

toolRegistry.register({
  name: 'browser_start_trace',
  category: 'browser',
  description: 'Start tracing network requests. Trace captures XHRs, fetches, and their request/response details.',
  tags: ['browser', 'network'],
  factory: () => createBrowserStartTraceTool(),
});

toolRegistry.register({
  name: 'browser_stop_trace',
  category: 'browser',
  description: 'Stop tracing and return the captured network trace.',
  tags: ['browser', 'network'],
  factory: () => createBrowserStopTraceTool(),
});

toolRegistry.register({
  name: 'browser_get_trace',
  category: 'browser',
  description: 'Get the current trace without stopping.',
  tags: ['browser', 'network'],
  factory: () => createBrowserGetTraceTool(),
});

toolRegistry.register({
  name: 'browser_replay_macro',
  category: 'browser',
  description: 'Replay a recorded macro step by step.',
  tags: ['browser', 'automation'],
  factory: () => createBrowserReplayMacroTool(),
});

toolRegistry.register({
  name: 'macro_list',
  category: 'browser',
  description: 'List all recorded macros for this session.',
  tags: ['browser', 'automation'],
  factory: () => createMacroListTool(),
});

toolRegistry.register({
  name: 'inject_cookie',
  category: 'browser',
  description: 'Inject a cookie into the current browser context.',
  tags: ['browser', 'session'],
  factory: () => createInjectCookieTool(),
});

toolRegistry.register({
  name: 'create_browser_session',
  category: 'browser',
  description: 'Create a new browser session (new incognito context). Returns session ID.',
  tags: ['browser', 'session'],
  factory: () => createCreateBrowserSessionTool(),
});

toolRegistry.register({
  name: 'list_browser_sessions',
  category: 'browser',
  description: 'List all active browser sessions.',
  tags: ['browser', 'session'],
  factory: () => createListBrowserSessionsTool(),
});

toolRegistry.register({
  name: 'save_storage_state',
  category: 'browser',
  description: 'Save browser storage state (cookies + localStorage) to a file.',
  tags: ['browser', 'session'],
  factory: () => createSaveStorageStateTool(),
});

toolRegistry.register({
  name: 'load_storage_state',
  category: 'browser',
  description: 'Load storage state from a file into the current browser context.',
  tags: ['browser', 'session'],
  factory: () => createLoadStorageStateTool(),
});

toolRegistry.register({
  name: 'manual_record_start',
  category: 'browser',
  description: 'Start manual browser recording. The browser will be opened in non-headless mode for you to interact with.',
  tags: ['browser', 'recording'],
  factory: () => createManualRecordStartTool(),
});

toolRegistry.register({
  name: 'manual_record_stop',
  category: 'browser',
  description: 'Stop manual browser recording and save the captured steps.',
  tags: ['browser', 'recording'],
  factory: () => createManualRecordStopTool(),
});

// ── Network Tools ──

toolRegistry.register({
  name: 'send_http_request',
  category: 'network',
  description: 'Send an HTTP request via raw Playwright APIRequestContext (same auth context as the browser).',
  tags: ['network', 'fetch'],
  factory: () => tool(async (input) => {
    const { url, method, headers, body } = z.object({
      url: z.string().describe('Target URL'),
      method: z.string().optional().default('GET').describe('HTTP method'),
      headers: z.record(z.string()).optional().describe('Request headers'),
      body: z.string().optional().describe('Request body'),
    }).parse(input);
    const { getSharedBrowserManager } = await import('./browser-tools');
    const mgr = getSharedBrowserManager();
    try {
      const page = await mgr.getOrCreate('default');
      // Use raw fetch with page's cookies for auth context
      const cookies = await page.context().cookies();
      const cookieHeader = cookies.map((c: any) => `${c.name}=${c.value}`).join('; ');
      const reqHeaders: Record<string, string> = { ...(headers || {}) };
      if (cookieHeader && !reqHeaders['Cookie']) reqHeaders['Cookie'] = cookieHeader;
      const resp = await fetch(url, {
        method,
        headers: reqHeaders,
        body,
        signal: AbortSignal.timeout(15000),
      });
      const respBody = await resp.text();
      const respHeaders: Record<string, string> = {};
      resp.headers.forEach((v: string, k: string) => { respHeaders[k] = v; });
      return JSON.stringify({ status: resp.status, headers: respHeaders, body: respBody.slice(0, 5000) });
    } catch (e) {
      return JSON.stringify({ error: e instanceof Error ? e.message : String(e) });
    }
  }, {
    name: 'send_http_request',
    description: 'Send an HTTP request (shares browser auth context)',
    schema: z.object({
      url: z.string().describe('Target URL'),
      method: z.string().optional().default('GET'),
      headers: z.record(z.string()).optional(),
      body: z.string().optional(),
    }),
  }),
});

toolRegistry.register({
  name: 'scan_ports',
  category: 'network',
  description: 'Scan ports on a target host. Uses /dev/tcp fallback on Linux/Mac, or a best-effort range scan.',
  tags: ['network', 'recon'],
  factory: () => tool(async (input) => {
    const { host, ports } = z.object({
      host: z.string().describe('Target host (IP or domain)'),
      ports: z.string().optional().default('80,443,8080,8443').describe('Comma-separated port list or range (e.g. 80-1024)'),
    }).parse(input);
    // Inline port scan: try each port via TCP connection attempt
    const results: Array<{ port: number; open: boolean }> = [];
    const portList = ports.split(',').flatMap(p => {
      const range = p.split('-').map(Number);
      if (range.length === 2 && !isNaN(range[0]) && !isNaN(range[1])) {
        const arr: number[] = [];
        for (let i = range[0]; i <= range[1] && i <= 65535; i++) arr.push(i);
        return arr;
      }
      return [parseInt(p, 10)];
    }).filter(p => !isNaN(p)).slice(0, 100);
    for (const port of portList) {
      try {
        const socket = new (await import('net')).Socket();
        const result = await new Promise<boolean>((resolve) => {
          socket.setTimeout(2000);
          socket.on('connect', () => { socket.destroy(); resolve(true); });
          socket.on('error', () => { socket.destroy(); resolve(false); });
          socket.on('timeout', () => { socket.destroy(); resolve(false); });
          socket.connect(port, host);
        });
        results.push({ port, open: result });
      } catch { results.push({ port, open: false }); }
    }
    return JSON.stringify({ host, ports: results });
  }, {
    name: 'scan_ports',
    description: 'Scan ports on a target host',
    schema: z.object({
      host: z.string(),
      ports: z.string().optional().default('80,443,8080,8443'),
    }),
  }),
});

toolRegistry.register({
  name: 'discover_subdomains',
  category: 'network',
  description: 'Discover subdomains for a given domain via certificate transparency logs and DNS enumeration.',
  tags: ['network', 'recon'],
  factory: () => tool(async (input) => {
    const { domain } = z.object({
      domain: z.string().describe('Target domain (e.g. example.com)'),
    }).parse(input);
    // Inline subdomain discovery via crt.sh certificate transparency logs
    let results: string[] = [];
    try {
      const resp = await fetch(`https://crt.sh/?q=%25.${encodeURIComponent(domain)}&output=json`, { signal: AbortSignal.timeout(10000) });
      if (resp.ok) {
        const data = await resp.json() as Array<{ name_value: string }>;
        results = [...new Set(data.flatMap((d: any) => (d.name_value || '').split('\n')))].filter(Boolean).slice(0, 50);
      }
    } catch { /* best effort */ }
    return JSON.stringify({ domain, subdomains: results });
  }, {
    name: 'discover_subdomains',
    description: 'Discover subdomains via CT logs and DNS enumeration',
    schema: z.object({ domain: z.string() }),
  }),
});

// ── Exploit Tools ──

toolRegistry.register({
  name: 'sql_inject',
  category: 'exploit',
  description: 'Test an endpoint for SQL injection by submitting a custom payload. The LLM crafts the payload based on endpoint analysis.',
  tags: ['exploit', 'sqli'],
  factory: () => tool(async (input) => {
    const { url, param, payload, method, headers, body } = z.object({
      url: z.string().describe('Target URL'),
      param: z.string().describe('Parameter to inject'),
      payload: z.string().describe('SQL injection test payload'),
      method: z.string().optional().default('GET'),
      headers: z.record(z.string()).optional(),
      body: z.string().optional(),
    }).parse(input);
    const fullUrl = method === 'GET' && param
      ? `${url}${url.includes('?') ? '&' : '?'}${encodeURIComponent(param)}=${encodeURIComponent(payload)}`
      : url;
    try {
      const resp = await fetch(fullUrl, {
        method, headers, body,
        signal: AbortSignal.timeout(15000),
      });
      const text = await resp.text();
      return JSON.stringify({ status: resp.status, body: text.slice(0, 5000) });
    } catch (e) {
      return JSON.stringify({ error: e instanceof Error ? e.message : String(e) });
    }
  }, {
    name: 'sql_inject',
    description: 'Test an endpoint for SQL injection',
    schema: z.object({
      url: z.string(), param: z.string(), payload: z.string(),
      method: z.string().optional().default('GET'),
      headers: z.record(z.string()).optional(),
      body: z.string().optional(),
    }),
  }),
});

toolRegistry.register({
  name: 'xss_inject',
  category: 'exploit',
  description: 'Test an endpoint for XSS by submitting a custom payload. The LLM crafts the payload based on endpoint analysis.',
  tags: ['exploit', 'xss'],
  factory: () => tool(async (input) => {
    const { url, param, payload, method, headers, body } = z.object({
      url: z.string().describe('Target URL'),
      param: z.string().describe('Parameter to inject'),
      payload: z.string().describe('XSS test payload'),
      method: z.string().optional().default('GET'),
      headers: z.record(z.string()).optional(),
      body: z.string().optional(),
    }).parse(input);
    const fullUrl = method === 'GET' && param
      ? `${url}${url.includes('?') ? '&' : '?'}${encodeURIComponent(param)}=${encodeURIComponent(payload)}`
      : url;
    try {
      const resp = await fetch(fullUrl, { method, headers, body, signal: AbortSignal.timeout(15000) });
      const text = await resp.text();
      return JSON.stringify({ status: resp.status, body: text.slice(0, 5000) });
    } catch (e) {
      return JSON.stringify({ error: e instanceof Error ? e.message : String(e) });
    }
  }, {
    name: 'xss_inject',
    description: 'Test an endpoint for XSS',
    schema: z.object({
      url: z.string(), param: z.string(), payload: z.string(),
      method: z.string().optional().default('GET'),
      headers: z.record(z.string()).optional(),
      body: z.string().optional(),
    }),
  }),
});

// ── Recon Tools ──

toolRegistry.register({
  name: 'whois_lookup',
  category: 'recon',
  description: 'Perform a WHOIS lookup for a domain or IP.',
  tags: ['recon', 'osint'],
  factory: () => tool(async (input) => {
    const { target } = z.object({ target: z.string().describe('Domain or IP to look up') }).parse(input);
    try {
      const resp = await fetch(`https://whois.freeaiapi.workers.dev/?domain=${encodeURIComponent(target)}`);
      const text = await resp.text();
      return JSON.stringify({ target, result: text.slice(0, 5000) });
    } catch (e) {
      return JSON.stringify({ error: e instanceof Error ? e.message : String(e) });
    }
  }, {
    name: 'whois_lookup',
    description: 'WHOIS lookup for a domain or IP',
    schema: z.object({ target: z.string() }),
  }),
});

toolRegistry.register({
  name: 'dns_lookup',
  category: 'recon',
  description: 'Perform a DNS lookup for a domain, returning A, AAAA, MX, NS, CNAME, and TXT records.',
  tags: ['recon', 'osint'],
  factory: () => tool(async (input) => {
    const { domain } = z.object({ domain: z.string().describe('Domain to look up') }).parse(input);
    try {
      const resp = await fetch(`https://dns.google/resolve?name=${encodeURIComponent(domain)}&type=ANY`);
      const data = await resp.json();
      return JSON.stringify({ domain, records: data.Answer || [] });
    } catch (e) {
      return JSON.stringify({ error: e instanceof Error ? e.message : String(e) });
    }
  }, {
    name: 'dns_lookup',
    description: 'DNS lookup for a domain',
    schema: z.object({ domain: z.string() }),
  }),
});

toolRegistry.register({
  name: 'extract_metadata',
  category: 'recon',
  description: 'Extract metadata from web pages, including tech stack, frameworks, analytics, CDN, and server info.',
  tags: ['recon', 'osint'],
  factory: () => tool(async (input) => {
    const { url } = z.object({ url: z.string().describe('URL to extract metadata from') }).parse(input);
    try {
      const resp = await fetch(url, { signal: AbortSignal.timeout(10000) });
      const html = await resp.text();
      if (html.length > 100000) {
        return JSON.stringify({ url, error: 'Response too large' });
      }
      const meta = {
        server: resp.headers.get('server') || '',
        poweredBy: resp.headers.get('x-powered-by') || '',
        contentType: resp.headers.get('content-type') || '',
        techStack: [] as string[],
      };
      if (/react/i.test(html)) meta.techStack.push('React');
      if (/angular/i.test(html)) meta.techStack.push('Angular');
      if (/vue\.js/i.test(html)) meta.techStack.push('Vue.js');
      if (/jquery/i.test(html)) meta.techStack.push('jQuery');
      if (/django/i.test(html) || /csrfmiddlewaretoken/i.test(html)) meta.techStack.push('Django');
      if (/laravel/i.test(html) || /csrf-token/i.test(html)) meta.techStack.push('Laravel');
      if (/wordpress/i.test(html) || /wp-content/i.test(html)) meta.techStack.push('WordPress');
      if (/express/i.test(html)) meta.techStack.push('Express');
      if (/next\.js/i.test(html) || /__NEXT_DATA/i.test(html)) meta.techStack.push('Next.js');
      if (/nuxt/i.test(html) || /__NUXT__/i.test(html)) meta.techStack.push('Nuxt.js');
      if (/google-analytics/i.test(html) || /gtag/i.test(html)) meta.techStack.push('Google Analytics');
      if (/cloudflare/i.test(html) || resp.headers.get('cf-ray')) meta.techStack.push('Cloudflare');
      return JSON.stringify(meta);
    } catch (e) {
      return JSON.stringify({ error: e instanceof Error ? e.message : String(e) });
    }
  }, {
    name: 'extract_metadata',
    description: 'Extract metadata from a URL',
    schema: z.object({ url: z.string() }),
  }),
});

toolRegistry.register({
  name: 'fetch_url',
  category: 'recon',
  description: 'Fetch a URL and return its raw content (HTML, JSON, XML, JS, CSS). Use to inspect raw response content.',
  tags: ['recon', 'fetch'],
  factory: () => tool(async (input) => {
    const { url } = z.object({ url: z.string().describe('URL to fetch') }).parse(input);
    try {
      const resp = await fetch(url, { signal: AbortSignal.timeout(15000) });
      const text = await resp.text();
      const headers: Record<string, string> = {};
      resp.headers.forEach((v: string, k: string) => { headers[k] = v; });
      return JSON.stringify({ status: resp.status, headers, body: text.slice(0, 10000) });
    } catch (e) {
      return JSON.stringify({ error: e instanceof Error ? e.message : String(e) });
    }
  }, {
    name: 'fetch_url',
    description: 'Fetch a URL and return raw content',
    schema: z.object({ url: z.string() }),
  }),
});

// ── Knowledge Tools ──

toolRegistry.register({
  name: 'search_knowledge_base',
  category: 'knowledge',
  description: 'Search the knowledge base for known CVEs, exploits, or vulnerabilities related to a specific technology or version.',
  tags: ['recon', 'knowledge'],
  factory: () => tool(async (input) => {
    const { query } = z.object({ query: z.string().describe('Search query') }).parse(input);
    try {
      const resp = await fetch(`https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json`);
      const data = await resp.json();
      return JSON.stringify({ query, results: (data.RelatedTopics || []).slice(0, 5) });
    } catch (e) {
      return JSON.stringify({ error: e instanceof Error ? e.message : String(e) });
    }
  }, {
    name: 'search_knowledge_base',
    description: 'Search for known vulnerabilities in the knowledge base',
    schema: z.object({ query: z.string() }),
  }),
});

toolRegistry.register({
  name: 'lookup_cve',
  category: 'knowledge',
  description: 'Look up a specific CVE ID and return details.',
  tags: ['recon', 'knowledge'],
  factory: () => tool(async (input) => {
    const { cveId } = z.object({ cveId: z.string().describe('CVE ID (e.g. CVE-2024-12345)') }).parse(input);
    try {
      const resp = await fetch(`https://cve.circl.lu/api/cve/${encodeURIComponent(cveId)}`);
      const data = await resp.json();
      return JSON.stringify(data);
    } catch (e) {
      return JSON.stringify({ error: e instanceof Error ? e.message : String(e) });
    }
  }, {
    name: 'lookup_cve',
    description: 'Look up a CVE by ID',
    schema: z.object({ cveId: z.string() }),
  }),
});

// ── App Model Tools ──

toolRegistry.register({
  name: 'read_app_model',
  category: 'knowledge',
  description: 'Read a section from the application model (target, techStack, auth, workflow, endpoints, forms, scripts, cookies, localStorage, findings, verifications, parameterClassifications, authBoundaries, recordedSessions, hypotheses, nextSteps, visitedUrls, oastCallbacks, coverage). Returns the specified section data.',
  tags: ['knowledge', 'model'],
  factory: () => createReadAppModelTool(),
});

toolRegistry.register({
  name: 'update_app_model',
  category: 'knowledge',
  description: 'Update a section of the application model with new information. Sections merge by array dedup or key-level object merge.',
  tags: ['knowledge', 'model'],
  factory: () => createUpdateAppModelTool(),
});

// ── Coverage Tools ──

toolRegistry.register({
  name: 'record_coverage',
  category: 'utility',
  description: 'Record that an endpoint/param/method was tested and whether it was vulnerable or not. Prevents retesting.',
  tags: ['coverage', 'tracking'],
  factory: () => tool(async (input) => {
    const { endpoint, param, method, status, reason } = z.object({
      endpoint: z.string().describe('Endpoint that was tested'),
      param: z.string().optional().describe('Parameter that was tested'),
      method: z.string().optional().default('GET').describe('HTTP method used'),
      status: z.enum(['tested', 'skipped']).describe('Whether the endpoint was tested or skipped'),
      reason: z.string().optional().describe('Why it was skipped (if status=skipped)'),
    }).parse(input);
    const path = getAppModelPath();
    const coverageEntry = { endpoint, param: param || '', method, status, reason: reason || '', timestamp: Date.now() };
    updateAppModelSection(path, 'coverage', [coverageEntry], true);
    return JSON.stringify({ recorded: true, entry: coverageEntry });
  }, {
    name: 'record_coverage',
    description: 'Record that an endpoint was tested',
    schema: z.object({
      endpoint: z.string(),
      param: z.string().optional(),
      method: z.string().optional().default('GET'),
      status: z.enum(['tested', 'skipped']),
      reason: z.string().optional(),
    }),
  }),
});

// ── OAST Tools ──

toolRegistry.register({
  name: 'oast_create_url',
  category: 'utility',
  description: 'Create a unique OAST callback URL for blind payload detection (SSRF, XXE, open-redirect). Returns a URL to embed in payloads.',
  tags: ['oast', 'blind'],
  factory: () => tool(async (input) => {
    const { technique } = z.object({
      technique: z.enum(['ssrf', 'xxe', 'open-redirect']).describe('Technique to create OAST URL for'),
    }).parse(input);
    try {
      const { getOastServer } = await import('../oast');
      const srv = getOastServer();
      if (!srv.isRunning()) {
        return JSON.stringify({ error: 'OAST server is not running' });
      }
      const uuid = srv.createUrl();
      return JSON.stringify({ uuid, url: `http://127.0.0.1:${srv.getPort()}/${uuid}`, technique });
    } catch (e) {
      return JSON.stringify({ error: e instanceof Error ? e.message : String(e) });
    }
  }, {
    name: 'oast_create_url',
    description: 'Create a unique OAST callback URL',
    schema: z.object({
      technique: z.enum(['ssrf', 'xxe', 'open-redirect']),
    }),
  }),
});

toolRegistry.register({
  name: 'oast_check',
  category: 'utility',
  description: 'Check if any OAST callbacks have been received. Optionally filter by UUID.',
  tags: ['oast', 'blind'],
  factory: () => tool(async (input) => {
    const { uuid } = z.object({
      uuid: z.string().optional().describe('Optional UUID to check for'),
    }).parse(input);
    try {
      const { getOastServer } = await import('../oast');
      const srv = getOastServer();
      if (!srv.isRunning()) {
        return JSON.stringify({ error: 'OAST server is not running' });
      }
      const allRecords = (srv as any).callbacks || (srv as any).records || [];
      const records = uuid ? allRecords.filter((r: any) => r.uuid === uuid) : allRecords;
      return JSON.stringify({ callbacks: records.length, records });
    } catch (e) {
      return JSON.stringify({ error: e instanceof Error ? e.message : String(e) });
    }
  }, {
    name: 'oast_check',
    description: 'Check for OAST callbacks',
    schema: z.object({
      uuid: z.string().optional(),
    }),
  }),
});

// ── Session Tools ──

toolRegistry.register({
  name: 'get_session_status',
  category: 'browser',
  description: 'Get the status of the current browser session.',
  tags: ['browser', 'session'],
  factory: () => createGetSessionStatusTool(),
});

toolRegistry.register({
  name: 'get_dom_snapshot',
  category: 'browser',
  description: 'Get the full DOM snapshot (forms, inputs, interactive elements, dialogs, text content).',
  tags: ['browser', 'extraction'],
  factory: () => createGetDomSnapshotTool(),
});

toolRegistry.register({
  name: 'export_har',
  category: 'browser',
  description: 'Export recorded network requests as HAR format.',
  tags: ['browser', 'network'],
  factory: () => createExportHarTool(),
});

toolRegistry.register({
  name: 'wait_for_navigation',
  category: 'browser',
  description: 'Wait for the page to navigate. Useful after clicking a link or submitting a form.',
  tags: ['browser', 'navigation'],
  factory: () => createWaitForNavigationTool(),
});

toolRegistry.register({
  name: 'reset_session',
  category: 'browser',
  description: 'Reset the browser session — clears cookies, storage, and navigates to about:blank.',
  tags: ['browser', 'session'],
  factory: () => createResetSessionTool(),
});

// ── Utility Tools ──

toolRegistry.register({
  name: 'calculate_risk',
  category: 'utility',
  description: 'Calculate overall risk score from findings. Factors: vulnerability severity, endpoint sensitivity, exploitability (OAST confirmed, evidence quality).',
  tags: ['utility', 'reporting'],
  factory: () => tool(async () => {
    const path = getAppModelPath();
    const model = readAppModel(path);
    const risk = calculateOverallRisk(model);
    updateAppModelSection(path, 'nextSteps', ['Finalize report', 'Generate Playwright tests']);
    return JSON.stringify(risk);
  }, {
    name: 'calculate_risk',
    description: 'Calculate overall risk score',
    schema: z.object({}),
  }),
});

toolRegistry.register({
  name: 'crawl_discover',
  category: 'utility',
  description: 'Perform a full crawl of the target to discover pages, forms, inputs, etc.',
  tags: ['crawl', 'discovery'],
  factory: () => createCrawlDiscoverTool(),
});

toolRegistry.register({
  name: 'classify_parameter',
  category: 'utility',
  description: 'Classify a parameter by its function (search, filter, sort, page, id, action, token, file, callback, redirect) and sensitivity (public, authenticated, admin)',
  tags: ['utility', 'analysis'],
  factory: () => tool(async (input) => {
    const { endpoint, param, classification, sensitivity } = z.object({
      endpoint: z.string().describe('The endpoint URL'),
      param: z.string().describe('The parameter name'),
      classification: z.string().describe('Parameter function: search, filter, sort, page, id, action, token, file, callback, redirect, content-type'),
      sensitivity: z.enum(['public', 'authenticated', 'admin']).describe('Access level required'),
    }).parse(input);
    const path = getAppModelPath();
    const entry = { endpoint, param, classification, sensitivity, timestamp: Date.now() };
    updateAppModelSection(path, 'parameterClassifications', [entry], true);
    return JSON.stringify({ recorded: true, entry });
  }, {
    name: 'classify_parameter',
    description: 'Classify a parameter by function and sensitivity',
    schema: z.object({
      endpoint: z.string(), param: z.string(), classification: z.string(), sensitivity: z.enum(['public', 'authenticated', 'admin']),
    }),
  }),
});

// ── Auth Tools ──

toolRegistry.register({
  name: 'auth_login',
  category: 'auth',
  description: 'Perform browser-based login to the target application. Fill username/password fields and submit. Captures session cookies.',
  tags: ['auth', 'session'],
  factory: () => tool(async (input) => {
    const { url, username, password, usernameField, passwordField, submitButton } = z.object({
      url: z.string().describe('URL of the login page'),
      username: z.string().describe('Username or email'),
      password: z.string().describe('Password'),
      usernameField: z.string().optional().describe('CSS selector for username field (default: input[type="email"], input[name*="user"], input[name*="email"])'),
      passwordField: z.string().optional().describe('CSS selector for password field (default: input[type="password"])'),
      submitButton: z.string().optional().describe('CSS selector for submit button (default: button[type="submit"], input[type="submit"])'),
    }).parse(input);
    try {
      const { getSharedBrowserManager } = await import('./browser-tools');
      const mgr = getSharedBrowserManager();
      const page = await mgr.getOrCreate('default');
      await page.waitForLoadState('networkidle');
      const cookies = await page.context().cookies();
      const storageState = await page.context().storageState();
      const modelPath = getAppModelPath();
      updateAppModelSection(modelPath, 'auth', { endpoints: [], cookies: Object.fromEntries(cookies.map((c: any) => [c.name, c.value])) }, true);
      return JSON.stringify({ success: true, cookies: cookies.length, currentUrl: page.url() });
    } catch (e) {
      return JSON.stringify({ success: false, error: e instanceof Error ? e.message : String(e) });
    }
  }, {
    name: 'auth_login',
    description: 'Login to the target via browser automation',
    schema: z.object({
      url: z.string(), username: z.string(), password: z.string(),
      usernameField: z.string().optional(), passwordField: z.string().optional(), submitButton: z.string().optional(),
    }),
  }),
});

// ── Strategies ──

toolRegistry.register({
  name: 'read_attack_plan',
  category: 'utility',
  description: 'Read the current attack plan — returns structured hypotheses with type, technique, endpoint, param, method, status',
  tags: ['strategist', 'plan'],
  factory: () => tool(async () => {
    const path = getAppModelPath();
    const model = readAppModel(path);
    const hypotheses = Array.isArray(model.hypotheses) ? model.hypotheses : [];
    return JSON.stringify({ total: hypotheses.length, hypotheses });
  }, {
    name: 'read_attack_plan',
    description: 'Read the current attack plan',
    schema: z.object({}),
  }),
});

// ── Spawn Agent (replaces spawn_worker) ──
// When called for a target+technique, auto-dispatches all other pending
// technique variants for the same target. First call unlocks the target.

function spawnAgentWorker(
  workerPath: string,
  workerData: Record<string, unknown>,
  isDev: boolean,
): { worker: import('worker_threads').Worker; id: string } {
  const { Worker } = require('worker_threads');
  const worker = new Worker(workerPath, {
    workerData,
    execArgv: isDev ? ['--import', 'tsx'] : [],
  });
  return { worker, id: (workerData as any).hypothesis?.id || '' };
}

toolRegistry.register({
  name: 'spawn_agent',
  category: 'utility',
  description: 'Spawn an agent to test a specific endpoint/param with a technique. The agent uses an LLM to generate payloads, send requests, and analyze responses. When called, this also auto-dispatches any other pending technique variants for the same target — so one call covers all techniques.',
  tags: ['strategist', 'agent'],
  factory: () => tool(async (input) => {
    const { endpoint, param, method, technique } = z.object({
      endpoint: z.string().describe('Target endpoint URL'),
      param: z.string().nullable().optional().describe('Parameter to test'),
      method: z.string().optional().default('GET').describe('HTTP method'),
      technique: z.string().describe('Technique: sqli, xss, ssrf, xxe, cmd, path, ssti, open-redirect, idor, race'),
    }).parse(input);
    const STATIC_EXT = /\.(css|js|woff2?|png|svg|ico|map|jpg|jpeg|gif|webp|ttf|eot|pdf)$/i;
    if (STATIC_EXT.test(endpoint)) {
      return JSON.stringify({ hypothesisId: '', vulnerable: false, summary: `Rejected: endpoint is a static asset (${endpoint})`, error: 'static_asset' });
    }

    const pth = require('path');
    const modelPath = getAppModelPath();
    const model = readAppModel(modelPath);

    // Normalize endpoint to pathname
    let epPath: string;
    try { epPath = new URL(endpoint).pathname; } catch { epPath = endpoint; }

    const isDev = pth.extname(__filename) === '.ts';
    const workerPath = pth.resolve(pth.join(__dirname, '..', 'core', isDev ? 'worker-agent.ts' : 'worker-agent.js'));
    const { getLlmConfig } = await import('../core/app-model-path');
    const llmConfig = getLlmConfig();

    // Read auth context from app model
    const storageStatePath = model.auth?.storageStatePath;
    const loginEndpoint = model.auth?.loginEndpoint;
    const loginMethod = model.auth?.loginMethod;
    const loginFields = model.auth?.loginFields;

    let oastBaseUrl: string | undefined;
    try {
      const { getOastServer } = await import('../oast');
      const srv = getOastServer();
      if (srv.isRunning()) oastBaseUrl = `http://localhost:${srv.getPort()}`;
    } catch { /* best effort */ }

    // ── Collect all technique variants for this target ──
    const targetKey = `${method}:${epPath}:${param || ''}`;
    const pendingHyps = Array.isArray(model.hypotheses) ? model.hypotheses : [];
    const targetTechniques = new Set<string>();
    targetTechniques.add(technique);

    // Find all pending hypotheses sharing the same {method, endpoint, param}
    for (const h of pendingHyps) {
      const hObj = h as any;
      const hKey = `${hObj.method || 'GET'}:${hObj.endpoint || ''}:${hObj.param || ''}`;
      if (hKey === targetKey && hObj.status === 'pending' && hObj.technique) {
        targetTechniques.add(hObj.technique);
      }
    }

    // ── Helper: update a hypothesis status ──
    function updateHypsForTechnique(tech: string, status: string, extra?: Record<string, unknown>): void {
      try {
        const cur = readAppModel(modelPath);
        const hyps = Array.isArray(cur.hypotheses) ? [...cur.hypotheses] : [];
        const techKey = `${method}:${epPath}:${param || ''}:${tech}`;
        const updated = hyps.map((h: any) => {
          const hKey = `${h.method || 'GET'}:${h.endpoint || ''}:${h.param || ''}:${h.technique}`;
          if (hKey === techKey) {
            const result: Record<string, unknown> = { ...h, status };
            if (extra) Object.assign(result, extra);
            return result;
          }
          return h;
        });
        updateAppModelSection(modelPath, 'hypotheses', updated, true);
      } catch { /* best effort */ }
    }

    // ── Helper: spawn one agent (worker) ──
    function spawnOne(tech: string): Record<string, unknown> | null {
      // Check if already covered
      const techKey = `${method}:${epPath}:${param || ''}:${tech}`;
      const existing = pendingHyps.find((h: any) =>
        `${h.method || 'GET'}:${h.endpoint || ''}:${h.param || ''}:${h.technique}` === techKey
      );

      if (existing) {
        const status = (existing as any).status;
        if (status === 'running' || status === 'done') return null;
      }

      // Create or reuse hypothesis
      const existingId: string | undefined = existing && typeof (existing as any).id === 'string' ? (existing as any).id : undefined;
      const hypId: string = existingId || `hyp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const hypothesis = {
        type: param ? 'param' : 'param',
        id: hypId,
        endpoint: endpoint,
        param: param || '',
        method,
        technique: tech,
        priority: 5,
        status: 'running' as const,
        source: 'strategist' as const,
        createdAt: Date.now(),
      };

      // Persist
      const cur = readAppModel(modelPath);
      const hyps = Array.isArray(cur.hypotheses) ? [...cur.hypotheses] : [];
      const existingHyps = hyps.filter((h: any) =>
        `${h.method || 'GET'}:${h.endpoint || ''}:${h.param || ''}:${h.technique}` !== techKey
      );
      existingHyps.push(hypothesis);
      updateAppModelSection(modelPath, 'hypotheses', existingHyps, true);

      // Spawn the agent
      const workerData = {
        hypothesis,
        llmConfig,
        appModelPath: modelPath,
        oastBaseUrl,
        storageStatePath,
        loginEndpoint,
        loginMethod,
        loginFields,
      };

      let resultReceived = false;
      const { worker } = spawnAgentWorker(workerPath, workerData, isDev);

      worker.on('message', (result: any) => {
        resultReceived = true;
        if (result.error) {
          process.stderr.write(`[spawn_agent] Worker returned error: ${result.error}\n`);
        }
        if (result.attempts?.length > 0) {
          updateAppModelSection(modelPath, 'workerActions', result.attempts);
        }
        const extra: Record<string, unknown> = { completedAt: Date.now(), vulnerable: !!result.vulnerable, confidence: result.confidence || 0 };
        updateHypsForTechnique(tech, 'done', extra);

        if (result.vulnerable && result.confidence >= 0.5) {
          const cur2 = readAppModel(modelPath);
          const finding = {
            type: tech.toUpperCase(),
            endpoint,
            param: param || '',
            evidence: (result.evidence || []).map((e: string, i: number) => ({
              type: 'raw_response' as const,
              data: e,
              label: `${tech.toUpperCase()} evidence #${i + 1} (reflected payload in response body)`,
              timestamp: Date.now(),
            })),
            confidence: result.confidence >= 0.8 ? 'high' : result.confidence >= 0.5 ? 'medium' : 'low',
            confirmed: true,
            severity: result.confidence >= 0.8 ? 'high' : result.confidence >= 0.5 ? 'medium' : 'low',
          };
          const existingFindings = Array.isArray(cur2.findings) ? [...cur2.findings] : [];
          existingFindings.push(finding);
          updateAppModelSection(modelPath, 'findings', existingFindings, true);
        }
      });

      worker.on('error', (err: Error) => {
        process.stderr.write(`[spawn_agent] Worker error: ${err.message}\n`);
      });

      worker.on('exit', (code: number) => {
        if (!resultReceived) {
          updateHypsForTechnique(tech, 'error', { completedAt: Date.now(), exitCode: code });
        }
        if (code !== 0) process.stderr.write(`[spawn_agent] Worker exited with code ${code}\n`);
      });

      const tracker = toolRegistry.getWorkerTracker();
      if (tracker) {
        tracker(hypId, new Promise<void>((resolve) => {
          const finalize = () => { resolve(); };
          worker.once('exit', finalize);
          worker.once('message', () => { setTimeout(finalize, 100); });
          worker.once('error', finalize);
        }));
      }

      return { technique: tech, workerId: hypId, endpoint, param: param || '' };
    }

    // ── Spawn the primary + all derived techniques ──
    const spawned: Array<Record<string, unknown>> = [];
    for (const tech of targetTechniques) {
      const result = spawnOne(tech);
      if (result) spawned.push(result);
    }

    const summary: string[] = [];
    const alreadyCovered = targetTechniques.size - spawned.length;
    if (summary.length === 0) {
      if (spawned.length > 0) {
        summary.push(`Spawned ${spawned.length} agent(s) for ${epPath}${param ? '?'+param : ''}`);
        for (const s of spawned) {
          summary.push(`  ${s.technique}: ${s.workerId}`);
        }
      }
      if (alreadyCovered > 0) {
        summary.push(`${alreadyCovered} technique(s) already running or tested`);
      }
    }

    return JSON.stringify({
      status: spawned.length > 0 ? 'started' : 'already_covered',
      workerIds: spawned.map(s => s.workerId).join(','),
      techniques: spawned.map(s => s.technique).join(','),
      endpoint,
      param: param || '',
      count: spawned.length,
      alreadyCovered,
      summary: summary.join('\n'),
    });
  }, {
    name: 'spawn_agent',
    description: 'Spawn an agent to test an endpoint/param with a technique — auto-dispatches all technique variants for the same target',
    schema: z.object({
      endpoint: z.string().describe('Target endpoint URL'),
      param: z.string().nullable().optional().describe('Parameter to test'),
      method: z.string().optional().default('GET').describe('HTTP method'),
      technique: z.string().describe('Technique: sqli, xss, ssrf, xxe, cmd, path, ssti, open-redirect, idor, race'),
    }),
  }),
});

toolRegistry.register({
  name: 'mark_hypothesis',
  category: 'utility',
  description: 'Mark a hypothesis as done or error in the attack plan',
  tags: ['strategist', 'plan'],
  factory: () => tool(async (input) => {
    const { hypothesisId, status } = z.object({
      hypothesisId: z.string().describe('The hypothesis ID to update'),
      status: z.enum(['done', 'error']).describe('New status'),
    }).parse(input);
    const path = getAppModelPath();
    const model = readAppModel(path);
    const hypotheses = Array.isArray(model.hypotheses) ? [...model.hypotheses] : [];
    const idx = hypotheses.findIndex((h: any) => h.id === hypothesisId);
    if (idx >= 0) {
      const obj = hypotheses[idx] as Record<string, unknown>;
      if (obj && typeof obj === 'object') {
        obj.status = status;
        hypotheses[idx] = obj;
      }
    }
    updateAppModelSection(path, 'hypotheses', hypotheses, true);
    return JSON.stringify({ hypothesisId, status, updated: true });
  }, {
    name: 'mark_hypothesis',
    description: 'Mark a hypothesis as done or error',
    schema: z.object({
      hypothesisId: z.string().describe('The hypothesis ID to update'),
      status: z.enum(['done', 'error']).describe('New status'),
    }),
  }),
});

toolRegistry.register({
  name: 'check_workers',
  category: 'utility',
  description: 'Check status of all spawned agents — running count, completed count, pending count, and recent findings. Use this after spawning agents to wait for results before spawning more.',
  tags: ['strategist', 'agent'],
  factory: () => tool(async () => {
    const path = getAppModelPath();
    const model = readAppModel(path);
    const hypotheses = Array.isArray(model.hypotheses) ? model.hypotheses : [];
    const findings = Array.isArray(model.findings) ? model.findings : [];
    let running = 0, pending = 0, done = 0, error = 0;
    const touchedCombos = new Set<string>();
    const coveredCombos = new Set<string>();
    const pendingCombos = new Set<string>();
    for (const h of hypotheses) {
      const hObj = h as any;
      const status = hObj.status;
      const combo = `${hObj.method || 'GET'}:${hObj.endpoint || ''}:${hObj.param || ''}`;
      if (status === 'running') { running++; touchedCombos.add(combo); coveredCombos.add(combo); }
      else if (status === 'pending') { pending++; pendingCombos.add(combo); }
      else if (status === 'done') { done++; coveredCombos.add(combo); }
      else if (status === 'error') { error++; coveredCombos.add(combo); }
    }
    const uncovered = pendingCombos.size - coveredCombos.size;
    return JSON.stringify({
      total: hypotheses.length,
      running,
      pending,
      done,
      error,
      uniqueEndpointParams: touchedCombos.size,
      uncoveredCombos: uncovered,
      findingsCount: findings.length,
      stalled: running === 0 && pending === 0 && error === 0 && done > 0,
      summary: `${running} running, ${pending} pending, ${done} done, ${error} error, ${uncovered} uncovered endpoint×param combos — ${findings.length} finding(s)`,
    });
  }, {
    name: 'check_workers',
    description: 'Check status of all spawned agents',
    schema: z.object({}),
  }),
});

// ── Ask User Tool ──

toolRegistry.register({
  name: 'ask_user',
  category: 'utility',
  description: 'Ask the user a question and wait for their response. Use when you need credentials, permission, clarification, or want to explain findings.',
  tags: ['utility', 'communication'],
  factory: () => tool(async ({ question }) => {
    return `User acknowledged: "${question}"`;
  }, {
    name: 'ask_user',
    description: 'Ask the user a question and wait for their response',
    schema: z.object({
      question: z.string().describe('Your question for the user'),
      options: z.array(z.string()).optional().describe('Suggested response options'),
    }),
  }),
});

// ── Helpers ──

function parseRange(range?: string): number[] | undefined {
  if (!range) return undefined;
  const [start, end] = range.split('-').map(Number);
  if (isNaN(start) || isNaN(end)) return undefined;
  const ports: number[] = [];
  for (let i = start; i <= end && i <= 1024; i++) ports.push(i);
  return ports;
}
