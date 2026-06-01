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

type AnyTool = DynamicStructuredTool;

export interface ToolRegistryEntry {
  name: string;
  category: string;
  description: string;
  factory: () => AnyTool;
  tags: string[];
}

export class ToolRegistry {
  private registry: Map<string, ToolRegistryEntry> = new Map();

  register(entry: ToolRegistryEntry): void {
    this.registry.set(entry.name, entry);
  }

  get(name: string): AnyTool | undefined {
    return this.registry.get(name)?.factory();
  }

  getAll(): AnyTool[] {
    const tools: AnyTool[] = [];
    for (const entry of this.registry.values()) tools.push(entry.factory());
    return tools;
  }

  getByCategory(category: string): AnyTool[] {
    const tools: AnyTool[] = [];
    for (const entry of this.registry.values()) {
      if (entry.category === category) tools.push(entry.factory());
    }
    return tools;
  }

  getByTags(tags: string[]): AnyTool[] {
    const tools: AnyTool[] = [];
    for (const entry of this.registry.values()) {
      if (tags.some((t) => entry.tags.includes(t))) tools.push(entry.factory());
    }
    return tools;
  }

  listNames(): string[] { return Array.from(this.registry.keys()); }

  listByCategory(): Record<string, string[]> {
    const result: Record<string, string[]> = {};
    for (const entry of this.registry.values()) {
      if (!result[entry.category]) result[entry.category] = [];
      result[entry.category].push(entry.name);
    }
    return result;
  }

  has(name: string): boolean { return this.registry.has(name); }
}

export const toolRegistry = new ToolRegistry();

// ── Knowledge Tools ──

toolRegistry.register({
  name: 'calculate_risk',
  category: 'utility',
  description: 'Calculate the overall risk score from the app model findings. Returns a score (0-100), level (info/low/medium/high/critical), and breakdown by severity.',
  tags: ['utility', 'risk'],
  factory: () => tool(async (_input) => {
    const path = getAppModelPath();
    try {
      const model = readAppModel(path);
      const risk = calculateOverallRisk(model);
      return JSON.stringify(risk, null, 2);
    } catch (err) {
      return `Error: ${err instanceof Error ? err.message : String(err)}`;
    }
  }, {
    name: 'calculate_risk',
    description: 'Calculate overall risk score from app model findings',
    schema: z.object({}),
  }),
});

toolRegistry.register({
  name: 'render_workflow_graph',
  category: 'utility',
  description: 'Render the workflow graph from the app model as a Mermaid diagram. Shows how pages connect and which require auth.',
  tags: ['utility', 'workflow'],
  factory: () => tool(async (_input) => {
    const path = getAppModelPath();
    try {
      const model = readAppModel(path);
      return renderWorkflowGraph(model);
    } catch (err) {
      return `Error: ${err instanceof Error ? err.message : String(err)}`;
    }
  }, {
    name: 'render_workflow_graph',
    description: 'Render workflow graph as Mermaid diagram',
    schema: z.object({}),
  }),
});

toolRegistry.register({
  name: 'classify_parameter',
  category: 'utility',
  description: 'Classify a parameter by its purpose and save to the app model. Valid classifications: id, email, password, search, price, quantity, name, date, file, token, unknown.',
  tags: ['utility', 'recon'],
  factory: () => tool(async (input) => {
    const { param_name, page_url, classification, attack_hints } = z.object({
      param_name: z.string().describe('Name of the parameter'),
      page_url: z.string().describe('URL of the page where the parameter appears'),
      classification: z.enum(['id', 'email', 'password', 'search', 'price', 'quantity', 'name', 'date', 'file', 'token', 'unknown']).describe('Classified purpose of the parameter'),
      attack_hints: z.array(z.string()).optional().describe('Suggested attack strategies'),
    }).parse(input);
    const path = getAppModelPath();
    try {
      updateAppModelSection(path, 'parameterClassifications', [{
        paramName: param_name,
        pageUrl: page_url,
        classifiedAs: classification,
        attackHints: attack_hints || [],
      }]);
      return `Parameter "${param_name}" on ${page_url} classified as "${classification}".`;
    } catch (err) {
      return `Error: ${err instanceof Error ? err.message : String(err)}`;
    }
  }, {
    name: 'classify_parameter',
    description: 'Classify a parameter by purpose and save to app model',
    schema: z.object({
      param_name: z.string().describe('Name of the parameter'),
      page_url: z.string().describe('URL of the page where the parameter appears'),
      classification: z.enum(['id', 'email', 'password', 'search', 'price', 'quantity', 'name', 'date', 'file', 'token', 'unknown']).describe('Classified purpose of the parameter'),
      attack_hints: z.array(z.string()).optional().describe('Suggested attack strategies'),
    }),
  }),
});

// ── HTTP & Network Tools ──

const HttpRequestSchema = z.object({
  method: z.enum(['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS', 'HEAD']).optional().default('GET').describe('HTTP method (default: GET)'),
  url: z.string().describe('Target URL to send the request to'),
  headers: z.record(z.string()).optional().describe('Optional HTTP headers as key-value pairs'),
  body: z.record(z.unknown()).optional().describe('Optional request body as JSON object'),
  followRedirects: z.boolean().optional().default(true).describe('Whether to follow HTTP redirects'),
});

toolRegistry.register({
  name: 'http_request',
  category: 'network',
  description: 'Send an HTTP request to a target URL with custom method, headers, and body',
  tags: ['network', 'http', 'api'],
  factory: () => tool(async (input) => {
    const { method, url, headers, body, followRedirects } = HttpRequestSchema.parse(u(input));
    try {
      const response = await fetch(url, { method, headers: headers || {}, body: body ? JSON.stringify(body) : undefined, redirect: followRedirects !== false ? 'follow' : 'manual' });
      const responseHeaders: Record<string, string> = {};
      response.headers.forEach((v, k) => { responseHeaders[k] = v; });
      const contentType = response.headers.get('content-type') || '';
      const responseBody = contentType.includes('json') ? JSON.stringify(await response.json(), null, 2) : await response.text();
      return `HTTP ${response.status} ${response.statusText}\nHeaders: ${JSON.stringify(responseHeaders, null, 2)}\nBody: ${responseBody.slice(0, 3000)}`;
    } catch (error) { return `Error: ${error instanceof Error ? error.message : String(error)}`; }
  }, { name: 'http_request', description: 'Send an HTTP request to a target URL', schema: HttpRequestSchema }),
});

const PortScanSchema = z.object({
  host: z.string().describe('Hostname or IP address to scan'),
  ports: z.array(z.number()).optional().describe('Specific ports to scan (overrides range)'),
  range: z.string().optional().describe('Port range like "1-1024"'),
});

toolRegistry.register({
  name: 'port_scan',
  category: 'network',
  description: 'Scan a host for open ports and identify services',
  tags: ['network', 'ports', 'infrastructure', 'recon'],
  factory: () => tool(async (input) => {
    const { host, ports, range } = PortScanSchema.parse(input);
    const net = await import('net');
    const targetPorts = ports || parseRange(range) || [80, 443, 3000, 8080, 8443];
    const results: Array<{ port: number; status: string; service?: string }> = [];
    const commonServices: Record<number, string> = { 21: 'FTP', 22: 'SSH', 23: 'Telnet', 25: 'SMTP', 53: 'DNS', 80: 'HTTP', 443: 'HTTPS', 3000: 'Node.js', 3306: 'MySQL', 5432: 'PostgreSQL', 6379: 'Redis', 8080: 'HTTP-Alt', 8443: 'HTTPS-Alt', 27017: 'MongoDB' };

    await Promise.all(targetPorts.map((port: number) => new Promise<void>((resolve) => {
      const socket = new net.Socket();
      const timeout = setTimeout(() => { socket.destroy(); results.push({ port, status: 'filtered' }); resolve(); }, 2000);
      socket.on('connect', () => { clearTimeout(timeout); socket.destroy(); results.push({ port, status: 'open', service: commonServices[port] }); resolve(); });
      socket.on('error', () => { clearTimeout(timeout); results.push({ port, status: 'closed' }); resolve(); });
      socket.connect(port, host);
    })));

    results.sort((a, b) => a.port - b.port);
    return `Port scan for ${host}:\n${results.map((r) => `- Port ${r.port}: ${r.status}${r.service ? ` (${r.service})` : ''}`).join('\n')}`;
  }, { name: 'port_scan', description: 'Scan a host for open ports', schema: PortScanSchema }),
});

const HeaderAnalyzeSchema = z.object({
  url: z.string().describe('Target URL to analyze headers for'),
  target: z.string().optional().describe('Alias for url'),
}).transform(v => ({ url: v.url || v.target || '' }));

toolRegistry.register({
  name: 'header_analyze',
  category: 'network',
  description: 'Analyze HTTP security headers for misconfigurations',
  tags: ['network', 'http', 'recon', 'security'],
  factory: () => tool(async (input) => {
    const { url } = HeaderAnalyzeSchema.parse(u(input));
    try {
      const response = await fetch(url);
      const headers: Record<string, string> = {};
      response.headers.forEach((v, k) => { headers[k] = v; });
      const securityHeaders = [
        { name: 'strict-transport-security', risk: 'Missing HSTS - vulnerable to downgrade attacks' },
        { name: 'content-security-policy', risk: 'Missing CSP - vulnerable to XSS' },
        { name: 'x-content-type-options', risk: 'Missing X-Content-Type-Options - MIME sniffing risk' },
        { name: 'x-frame-options', risk: 'Missing X-Frame-Options - clickjacking risk' },
        { name: 'referrer-policy', risk: 'Missing Referrer-Policy - information leakage' },
        { name: 'permissions-policy', risk: 'Missing Permissions-Policy' },
      ];
      const issues = securityHeaders.filter((h) => !headers[h.name]).map((h) => `- ⚠️ ${h.risk}`);
      return `Security headers for ${url}:\nServer: ${headers['server'] || headers['x-powered-by'] || 'Unknown'}\n\nMissing:\n${issues.length > 0 ? issues.join('\n') : 'None - all critical headers present'}`;
    } catch (error) { return `Error: ${error instanceof Error ? error.message : String(error)}`; }
  }, { name: 'header_analyze', description: 'Analyze HTTP security headers', schema: HeaderAnalyzeSchema }),
});

// ── Auth Boundary Probe Tool ──

const AuthProbeSchema = z.object({
  url: z.string().describe('URL to probe for auth requirements'),
  sessionId: z.string().default('default').describe('Browser session ID to check cookies from'),
});

toolRegistry.register({
  name: 'auth_probe',
  category: 'recon',
  description: 'Check whether a URL requires authentication by fetching it twice — once with current browser cookies, once without — and comparing responses (status, body length, redirect).',
  tags: ['recon', 'auth'],
  factory: () => tool(async (input) => {
    const { url, sessionId } = AuthProbeSchema.parse(u(input));
    const { getSharedBrowserManager } = await import('./browser-tools');
    const mgr = getSharedBrowserManager();
    try {
      if (!mgr.hasSession(sessionId)) {
        return JSON.stringify({ url, requiresAuth: 'unknown', error: 'No browser session exists. Use browser_navigate first to create one.' }, null, 2);
      }
      const page = await mgr.getOrCreate(sessionId);
      const cookies = await page.context().cookies(url);
      const cookieHeader = cookies.map((c: any) => `${c.name}=${c.value}`).join('; ');
      const headers: Record<string, string> = {};
      if (cookieHeader) headers['Cookie'] = cookieHeader;

      const authRes = await fetch(url, { headers, redirect: 'manual' });
      const authBody = await authRes.text();
      const noAuthRes = await fetch(url, { redirect: 'manual' });
      const noAuthBody = await noAuthRes.text();

      const sameStatus = authRes.status === noAuthRes.status;
      const sameBodyLen = authBody.length === noAuthBody.length;
      const authRedirected = authRes.status >= 300 && authRes.status < 400;
      const noAuthRedirected = noAuthRes.status >= 300 && noAuthRes.status < 400;

      const requiresAuth = (!sameStatus && [401, 403].includes(noAuthRes.status)) ||
        (!sameBodyLen && authBody.length > 0 && noAuthBody.length < 100) ||
        (!noAuthRedirected && authRedirected) ||
        (!sameStatus && noAuthRes.status === 200 && authRes.status !== 200);

      return JSON.stringify({
        url,
        requiresAuth,
        withAuth: { status: authRes.status, bodyLength: authBody.length, location: authRes.headers.get('location') },
        withoutAuth: { status: noAuthRes.status, bodyLength: noAuthBody.length, location: noAuthRes.headers.get('location') },
      }, null, 2);
    } catch (error) {
      return JSON.stringify({ url, error: error instanceof Error ? error.message : String(error) });
    }
  }, { name: 'auth_probe', description: 'Check if a URL requires authentication', schema: AuthProbeSchema }),
});

// ── Reconnaissance Tools ──

const JwtParseSchema = z.object({ token: z.string().describe('JWT token string to decode and analyze') });

toolRegistry.register({
  name: 'jwt_parse',
  category: 'auth',
  description: 'Decode and analyze JWT tokens for security issues (alg=none, expired, weak secrets)',
  tags: ['recon', 'auth', 'token'],
  factory: () => tool(async (input) => {
    const { token } = JwtParseSchema.parse(input);
    try {
      const parts = token.split('.');
      if (parts.length !== 3) return `Invalid JWT: expected 3 parts, got ${parts.length}`;
      const header = JSON.parse(Buffer.from(parts[0], 'base64url').toString());
      const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString());
      const issues: string[] = [];
      if (header.alg === 'none') issues.push('⚠️ CRITICAL: alg=none — token can be forged without signature');
      if (header.alg?.toLowerCase().includes('hs256') && header.alg !== 'HS256') issues.push(`⚠️ Unusual algorithm: ${header.alg}`);
      const now = Math.floor(Date.now() / 1000);
      if (payload.exp && payload.exp < now) issues.push(`⚠️ Token expired at ${new Date(payload.exp * 1000).toISOString()}`);
      if (!payload.exp) issues.push('⚠️ No expiration (exp) claim — token never expires');
      if (!payload.iat) issues.push('⚠️ No issued-at (iat) claim');
      if (payload.iss && !payload.iss.startsWith('https://')) issues.push(`⚠️ Issuer not HTTPS: ${payload.iss}`);
      if (payload.scope?.includes('admin') || payload.role?.includes('admin')) issues.push('ℹ️ Token has admin privileges');
      return `JWT Analysis:\n\nHeader: ${JSON.stringify(header, null, 2)}\n\nPayload: ${JSON.stringify(payload, null, 2)}\n\nIssues:\n${issues.length > 0 ? issues.map((i) => `- ${i}`).join('\n') : 'No obvious issues found'}`;
    } catch (error) { return `Error parsing JWT: ${error instanceof Error ? error.message : String(error)}`; }
  }, { name: 'jwt_parse', description: 'Decode and analyze JWT tokens', schema: JwtParseSchema }),
});

// ── API & GraphQL Tools ──

const GraphqlIntrospectSchema = z.object({ url: z.string().describe('GraphQL endpoint URL'), headers: z.record(z.string()).optional().describe('Optional HTTP headers for the introspection query') });

toolRegistry.register({
  name: 'graphql_introspect',
  category: 'api',
  description: 'Query GraphQL introspection to enumerate types, queries, mutations, and find IDOR candidates',
  tags: ['api', 'recon', 'graphql'],
  factory: () => tool(async (input) => {
    const { url, headers } = GraphqlIntrospectSchema.parse(u(input));
    const introspectionQuery = `query { __schema { types { name fields { name args { name type { name kind ofType { name kind } } } type { name kind ofType { name kind } } } } queryType { name } mutationType { name } } }`;
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...headers },
        body: JSON.stringify({ query: introspectionQuery }),
      });
      if (!response.ok) return `GraphQL introspection failed: HTTP ${response.status}`;
      const data = await response.json();
      if (data.errors) return `GraphQL introspection blocked: ${JSON.stringify(data.errors)}`;
      const schema = data.data?.__schema;
      if (!schema) return 'No schema returned';
      const queries = schema.queryType?.name ? schema.types.find((t: Record<string, unknown>) => t.name === schema.queryType.name)?.fields || [] : [];
      const mutations = schema.mutationType?.name ? schema.types.find((t: Record<string, unknown>) => t.name === schema.mutationType.name)?.fields || [] : [];
      const idorCandidates = queries.filter((f: Record<string, unknown>) => {
        const fn = (f.name as string).toLowerCase();
        return fn.includes('id') || fn.includes('user') || fn.includes('get') || fn.includes('find');
      });
      return `GraphQL Schema for ${url}:\n\nQueries: ${queries.length}\n${queries.map((q: Record<string, unknown>) => `- ${q.name}(${Array.isArray(q.args) ? (q.args as Array<Record<string, string>>).map((a) => a.name).join(', ') : ''})`).join('\n')}\n\nMutations: ${mutations.length}\n${mutations.map((m: Record<string, string>) => `- ${m.name}`).join('\n')}\n\nPotential IDOR candidates:\n${idorCandidates.map((c: Record<string, string>) => `- ${c.name}`).join('\n') || 'None identified'}`;
    } catch (error) { return `Error: ${error instanceof Error ? error.message : String(error)}`; }
  }, { name: 'graphql_introspect', description: 'Query GraphQL introspection', schema: GraphqlIntrospectSchema }),
});

// ── Reconnaissance Tools ──

const SubdomainEnumSchema = z.object({ domain: z.string().describe('Domain name to enumerate subdomains for (e.g. example.com)') });

toolRegistry.register({
  name: 'subdomain_enum',
  category: 'recon',
  description: 'Enumerate subdomains via passive sources (crt.sh, securitytrails, hackertarget)',
  tags: ['recon', 'subdomain', 'dns', 'enumeration'],
  factory: () => tool(async (input) => {
    const { domain } = SubdomainEnumSchema.parse(input);
    const sources = [
      { name: 'crt.sh', url: `https://crt.sh/?q=${domain}&output=json` },
      { name: 'hackertarget', url: `https://api.hackertarget.com/hostsearch/?q=${domain}` },
    ];
    const subdomains = new Set<string>();
    for (const source of sources) {
      try {
        const res = await fetch(source.url);
        const text = await res.text();
        if (source.name === 'crt.sh') {
          const certs = JSON.parse(text);
          for (const cert of certs) {
            const names = (cert.name_value || '').split('\n');
            for (const name of names) {
              if (name.endsWith(domain) && !name.includes('*')) subdomains.add(name);
            }
          }
        } else {
          for (const line of text.split('\n')) {
            const parts = line.split(',');
            if (parts[0]?.endsWith(domain)) subdomains.add(parts[0]);
          }
        }
      } catch { /* skip failed sources */ }
    }
    return `Subdomains for ${domain}:\n\n${Array.from(subdomains).sort().map((s) => `- ${s}`).join('\n') || 'No subdomains found'}\n\nTotal: ${subdomains.size}`;
  }, { name: 'subdomain_enum', description: 'Enumerate subdomains via passive sources', schema: SubdomainEnumSchema }),
});

toolRegistry.register({
  name: 'dir_bruteforce',
  category: 'recon',
  description: 'Discover hidden directories and files via common wordlist probing',
  tags: ['recon', 'directory', 'enumeration'],
  factory: () => tool(async (input) => {
    const { url, wordlist } = z.object({
      url: z.string().describe('Target URL to discover hidden directories on'),
      wordlist: z.array(z.string()).optional().describe('Custom wordlist of paths/names to check'),
    }).parse(u(input));
    const commonPaths = wordlist || [
      'admin', 'login', 'api', 'debug', 'console', 'dashboard', 'config',
      'backup', 'db', 'database', 'test', 'staging', 'dev', '.env',
      '.git', '.git/config', 'wp-admin', 'phpmyadmin', 'server-status',
      'robots.txt', 'sitemap.xml', '.well-known', 'swagger', 'graphql',
    ];
    const found: Array<{ path: string; status: number; size: number }> = [];
    await Promise.all(commonPaths.map(async (path) => {
      try {
        const res = await fetch(`${url}/${path}`, { method: 'HEAD' });
        if (res.status !== 404 && res.status !== 403) found.push({ path, status: res.status, size: parseInt(res.headers.get('content-length') || '0') });
      } catch { /* skip */ }
    }));
    return `Directory brute force for ${url}:\n\nFound ${found.length} non-404 paths:\n${found.map((f) => `- [${f.status}] /${f.path} (${f.size} bytes)`).join('\n') || 'Nothing interesting found'}`;
  }, { name: 'dir_bruteforce', description: 'Discover hidden directories', schema: z.object({ url: z.string().describe('Target URL to discover hidden directories on'), wordlist: z.array(z.string()).optional().describe('Custom wordlist of paths/names to check') }) }),
});

// ── Browser Control Tools ──

toolRegistry.register({
  name: 'browser_navigate',
  category: 'browser',
  description: 'Navigate a browser session to a URL',
  tags: ['browser', 'playwright', 'navigation'],
  factory: () => createBrowserNavigateTool(),
});

toolRegistry.register({
  name: 'browser_click',
  category: 'browser',
  description: 'Click an element identified by CSS selector in a browser session',
  tags: ['browser', 'playwright', 'dom', 'interaction'],
  factory: () => createBrowserClickTool(),
});

toolRegistry.register({
  name: 'browser_fill',
  category: 'browser',
  description: 'Fill a form field with a value in a browser session',
  tags: ['browser', 'playwright', 'form', 'input'],
  factory: () => createBrowserFillTool(),
});

toolRegistry.register({
  name: 'browser_press_key',
  category: 'browser',
  description: 'Press a keyboard key in the browser session (e.g. "Enter", "Escape", "Tab", "ArrowDown", "Control+a"). Use after browser_fill to submit forms/chat messages.',
  tags: ['browser', 'playwright', 'keyboard', 'form', 'submit'],
  factory: () => createBrowserPressKeyTool(),
});

toolRegistry.register({
  name: 'browser_screenshot',
  category: 'browser',
  description: 'Take a screenshot of the current page in a browser session (returns base64 PNG)',
  tags: ['browser', 'playwright', 'screenshot', 'visual'],
  factory: () => createBrowserScreenshotTool(),
});

toolRegistry.register({
  name: 'browser_extract',
  category: 'browser',
  description: 'Extract content from the current page in a browser session (text, html, or links)',
  tags: ['browser', 'playwright', 'dom', 'extraction'],
  factory: () => createBrowserExtractTool(),
});

toolRegistry.register({
  name: 'browser_evaluate',
  category: 'browser',
  description: 'Execute JavaScript in the browser session page context',
  tags: ['browser', 'playwright', 'javascript', 'evaluation'],
  factory: () => createBrowserEvaluateTool(),
});

toolRegistry.register({
  name: 'browser_get_forms',
  category: 'browser',
  description: 'Extract all forms from the current page with fields, actions, and methods for security analysis',
  tags: ['browser', 'forms', 'recon', 'analysis'],
  factory: () => createBrowserGetFormsTool(),
});

toolRegistry.register({
  name: 'browser_get_cookies',
  category: 'browser',
  description: 'Get all cookies for the current page context including httpOnly, secure, sameSite flags',
  tags: ['browser', 'cookies', 'auth', 'recon'],
  factory: () => createBrowserGetCookiesTool(),
});

toolRegistry.register({
  name: 'browser_get_scripts',
  category: 'browser',
  description: 'List all external scripts loaded on the current page for supply chain analysis',
  tags: ['browser', 'scripts', 'recon', 'supply-chain'],
  factory: () => createBrowserGetScriptsTool(),
});

toolRegistry.register({
  name: 'browser_get_storage',
  category: 'browser',
  description: 'Get all localStorage entries for the current page origin — useful for finding tokens, secrets, app state',
  tags: ['browser', 'storage', 'tokens', 'recon'],
  factory: () => createBrowserGetStorageTool(),
});

toolRegistry.register({
  name: 'browser_close',
  category: 'browser',
  description: 'Close a browser session and release all resources',
  tags: ['browser', 'playwright', 'session', 'cleanup'],
  factory: () => createBrowserCloseTool(),
});

// ── Page Info Tool ──

toolRegistry.register({
  name: 'get_page_info',
  category: 'browser',
  description: 'Get current page information: URL, title, readyState, visible text length, and number of links/forms. Faster than multiple browser_extract calls.',
  tags: ['browser', 'utility', 'page'],
  factory: () => tool(async (input) => {
    const { sessionId } = z.object({
      sessionId: z.string().default('default').describe('Browser session ID'),
    }).parse(input);
    const { getSharedBrowserManager } = await import('./browser-tools');
    const mgr = getSharedBrowserManager();
    if (!mgr.hasSession(sessionId)) return 'No browser session active. Use browser_navigate first.';
    try {
      const page = await mgr.getOrCreate(sessionId);
      const info = await page.evaluate(() => ({
        url: window.location.href,
        title: document.title,
        readyState: document.readyState,
        textLength: document.body?.innerText?.length || 0,
        linkCount: document.querySelectorAll('a[href]').length,
        formCount: document.querySelectorAll('form').length,
        scriptCount: document.querySelectorAll('script[src]').length,
      }));
      return JSON.stringify(info, null, 2);
    } catch (err) {
      return `Error: ${err instanceof Error ? err.message : String(err)}`;
    }
  }, {
    name: 'get_page_info',
    description: 'Get current page info (URL, title, state)',
    schema: z.object({
      sessionId: z.string().default('default').describe('Browser session ID'),
    }),
  }),
});

// ── Session Recording Tools ──

toolRegistry.register({
  name: 'macro_record_start',
  category: 'browser',
  description: 'Start recording browser actions (navigate, click, fill) on a session. Stop with macro_record_stop, then save steps to app model.',
  tags: ['browser', 'recording', 'macro'],
  factory: () => createBrowserStartRecordingTool(),
});

toolRegistry.register({
  name: 'macro_record_stop',
  category: 'browser',
  description: 'Stop recording and return the recorded steps summary. Save steps to app model\'s recordedSessions section with update_app_model for later replay.',
  tags: ['browser', 'recording', 'macro'],
  factory: () => createBrowserStopRecordingTool(),
});

toolRegistry.register({
  name: 'manual_record_start',
  category: 'browser',
  description: 'Start recording DIRECT manual browser interactions. Opens the visible Playwright window so a human can click, type, and navigate. Every action is captured as a macro step. Use manual_record_stop to finish and save to the app model.',
  tags: ['browser', 'recording', 'manual', 'human'],
  factory: () => createManualRecordStartTool(),
});

toolRegistry.register({
  name: 'manual_record_stop',
  category: 'browser',
  description: 'Stop manual recording and return the captured macro steps. Use update_app_model to save them to the app model for later replay. The steps can be replayed with browser_replay_macro.',
  tags: ['browser', 'recording', 'manual', 'human'],
  factory: () => createManualRecordStopTool(),
});

toolRegistry.register({
  name: 'browser_get_recording',
  category: 'browser',
  description: 'Get the current recorded actions for a browser session without stopping recording',
  tags: ['browser', 'recording', 'macro'],
  factory: () => createBrowserGetRecordingTool(),
});

toolRegistry.register({
  name: 'browser_replay_macro',
  category: 'browser',
  description: 'Replay a named recorded macro from the app model (recordedSessions section) on a browser session',
  tags: ['browser', 'replay', 'macro'],
  factory: () => createBrowserReplayMacroTool(),
});

toolRegistry.register({
  name: 'macro_list',
  category: 'utility',
  description: 'List all named recorded macros saved in the app model recordedSessions section',
  tags: ['utility', 'macro'],
  factory: () => createMacroListTool(),
});

// ── Cookie Injection Tool ──

toolRegistry.register({
  name: 'inject_cookie',
  category: 'browser',
  description: 'Set a cookie in the browser context. Useful for injecting auth tokens or session cookies discovered via app model.',
  tags: ['browser', 'cookies', 'auth'],
  factory: () => createInjectCookieTool(),
});

// ── Session Pool Tools ──

toolRegistry.register({
  name: 'create_browser_session',
  category: 'browser',
  description: 'Create a named browser session with optional label and user agent. Sessions are isolated (separate cookies, storage, and browser context).',
  tags: ['browser', 'session'],
  factory: () => createCreateBrowserSessionTool(),
});

toolRegistry.register({
  name: 'list_browser_sessions',
  category: 'browser',
  description: 'List all active browser sessions with their labels, current URLs, and creation times.',
  tags: ['browser', 'session', 'utility'],
  factory: () => createListBrowserSessionsTool(),
});

// ── Auth State Serialization Tools ──

toolRegistry.register({
  name: 'save_storage_state',
  category: 'utility',
  description: 'Save browser session state (cookies + localStorage) to a file. Useful for persisting auth state between assessment phases.',
  tags: ['utility', 'auth', 'session'],
  factory: () => createSaveStorageStateTool(),
});

toolRegistry.register({
  name: 'load_storage_state',
  category: 'utility',
  description: 'Restore a previously saved browser session state (cookies + localStorage) from a file. Use to re-authenticate without replaying login flows.',
  tags: ['utility', 'auth', 'session'],
  factory: () => createLoadStorageStateTool(),
});

// ── Trace Tools ──

toolRegistry.register({
  name: 'browser_start_trace',
  category: 'browser',
  description: 'Start automatic request tracing on a browser session. Captures all network requests silently.',
  tags: ['browser', 'trace', 'network'],
  factory: () => createBrowserStartTraceTool(),
});

toolRegistry.register({
  name: 'browser_stop_trace',
  category: 'browser',
  description: 'Stop automatic request tracing and return the count of captured entries',
  tags: ['browser', 'trace', 'network'],
  factory: () => createBrowserStopTraceTool(),
});

toolRegistry.register({
  name: 'browser_get_trace',
  category: 'browser',
  description: 'Show captured network trace entries for a session. Optionally filter by type (navigation, xhr, fetch, form, resource, script).',
  tags: ['browser', 'trace', 'network'],
  factory: () => createBrowserGetTraceTool(),
});

// ── App Model Tools ──

toolRegistry.register({
  name: 'read_app_model',
  category: 'utility',
  description: 'Read the app model JSON file — the persistent memory shared across all phases. Optionally read only one section (target, techStack, auth, workflow, endpoints, forms, etc.)',
  tags: ['utility', 'app-model', 'memory'],
  factory: () => createReadAppModelTool(),
});

toolRegistry.register({
  name: 'update_app_model',
  category: 'utility',
  description: 'Update a section of the app model JSON file. Use this to record new endpoints, forms, findings, workflow nodes/edges, hypotheses, or tech stack as you discover them.',
  tags: ['utility', 'app-model', 'memory'],
  factory: () => createUpdateAppModelTool(),
});

// ── Crawl Tool ──

toolRegistry.register({
  name: 'crawl_discover',
  category: 'recon',
  description: 'Run the automated spider to discover routes, forms, links, cookies, and tech stack. Optionally saves results to the app model. Use to rapidly map a new target.',
  tags: ['recon', 'explore', 'browser'],
  factory: () => createCrawlDiscoverTool(),
});

// ── OAST Tools ──

toolRegistry.register({
  name: 'oast_create_url',
  category: 'utility',
  description: 'Create a unique OAST callback URL. Use this URL in blind payloads (XSS, SSRF, SQLi) to detect out-of-band callbacks. Save the returned uuid, then use oast_check with that uuid to see if a callback was received.',
  tags: ['utility', 'oast', 'exploit'],
  factory: () => tool(async () => {
    const { getOastServer } = await import('../oast');
    const srv = getOastServer();
    const { uuid, url } = srv.createUrl();
    return JSON.stringify({ uuid, url, note: 'Use this URL in blind payloads. Check back later with oast_check.' }, null, 2);
  }, {
    name: 'oast_create_url',
    description: 'Create a unique OAST callback URL for blind payload detection',
    schema: z.object({}),
  }),
});

toolRegistry.register({
  name: 'oast_check',
  category: 'utility',
  description: 'Check for OAST callbacks. Pass a uuid to check a specific URL, or omit to check all. Returns any requests that hit the OAST server from blind payloads.',
  tags: ['utility', 'oast', 'exploit'],
  factory: () => tool(async (input) => {
    const { uuid } = z.object({
      uuid: z.string().optional().describe('Optional UUID to check for specific callback'),
    }).parse(input);
    const { getOastServer } = await import('../oast');
    const srv = getOastServer();
    const callbacks = srv.checkCallbacks(uuid);
    if (callbacks.length === 0) return JSON.stringify({ callbacks: [], message: 'No callbacks received yet.' }, null, 2);
    return JSON.stringify({
      callbacks: callbacks.map(c => ({
        uuid: c.uuid,
        timestamp: new Date(c.timestamp).toISOString(),
        method: c.method,
        url: c.url,
        remoteAddress: c.remoteAddress,
        body: c.body ? c.body.slice(0, 200) : null,
      })),
      count: callbacks.length,
    }, null, 2);
  }, {
    name: 'oast_check',
    description: 'Check for OAST callbacks from blind payloads',
    schema: z.object({
      uuid: z.string().optional().describe('Specific UUID to check, or omit for all'),
    }),
  }),
});

// ── Coverage Tool ──

toolRegistry.register({
  name: 'record_coverage',
  category: 'utility',
  description: 'Record that an endpoint/param was tested or skipped. This tracks coverage so you can see what was probed and what was skipped (and why).',
  tags: ['utility', 'coverage', 'recon'],
  factory: () => tool(async (input) => {
    const { endpoint, method, param, status, reason } = z.object({
      endpoint: z.string().describe('The endpoint URL or path'),
      method: z.string().describe('HTTP method (GET, POST, PUT, DELETE, etc.)'),
      param: z.string().describe('The parameter name, or "none" if no parameter'),
      status: z.enum(['tested', 'skipped']).describe('Whether the parameter was tested or skipped'),
      reason: z.string().describe('Why it was tested or skipped (e.g., "auth required", "injected SQLi", "not applicable")'),
    }).parse(input);
    const path = getAppModelPath();
    const { readAppModel, writeAppModel } = await import('../core/app-model');
    const model = readAppModel(path);
    const entry = { endpoint, method, param, status, reason, timestamp: Date.now() };
    if (!model.coverage) model.coverage = [];
    const key = `${method}:${endpoint}:${param}`;
    const existing = model.coverage.findIndex(c => `${c.method}:${c.endpoint}:${c.param}` === key);
    if (existing >= 0) model.coverage[existing] = entry;
    else model.coverage.push(entry);
    writeAppModel(path, model);
    return JSON.stringify({ recorded: entry, totalCoverage: model.coverage.length }, null, 2);
  }, {
    name: 'record_coverage',
    description: 'Record that an endpoint/param was tested or skipped',
    schema: z.object({
      endpoint: z.string().describe('Endpoint URL or path'),
      method: z.string().describe('HTTP method'),
      param: z.string().describe('Parameter name, or "none"'),
      status: z.enum(['tested', 'skipped']).describe('Tested or skipped'),
      reason: z.string().describe('Why it was tested or skipped'),
    }),
  }),
});

// ── Session Tools ──

toolRegistry.register({
  name: 'get_session_status',
  category: 'utility',
  description: 'Check the current status of a browser session — URL, recording step count, tracing state.',
  tags: ['utility', 'session'],
  factory: () => createGetSessionStatusTool(),
});

toolRegistry.register({
  name: 'get_dom_snapshot',
  category: 'browser',
  description: 'Take a DOM snapshot of the current page — returns forms, interactive elements, dialogs, overlays.',
  tags: ['browser', 'recon'],
  factory: () => createGetDomSnapshotTool(),
});

toolRegistry.register({
  name: 'export_har',
  category: 'utility',
  description: 'Export the current network trace as a HAR file, then restart tracing.',
  tags: ['utility', 'network'],
  factory: () => createExportHarTool(),
});

toolRegistry.register({
  name: 'wait_for_navigation',
  category: 'browser',
  description: 'Wait for the current page to finish loading after a click or form submit.',
  tags: ['browser', 'navigation'],
  factory: () => createWaitForNavigationTool(),
});

toolRegistry.register({
  name: 'reset_session',
  category: 'browser',
  description: 'Clear cookies, localStorage, and sessionStorage without closing the browser.',
  tags: ['browser', 'session', 'auth'],
  factory: () => createResetSessionTool(),
});

// ── Strategist Tools (read_attack_plan, spawn_worker, mark_hypothesis) ──

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

toolRegistry.register({
  name: 'spawn_worker',
  category: 'utility',
  description: 'Spawn a worker thread to test a specific endpoint/param with a technique. The worker uses an LLM to generate payloads, send requests, and analyze responses.',
  tags: ['strategist', 'worker'],
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
    const { Worker } = await import('worker_threads');
    const pth = await import('path');
    const modelPath = getAppModelPath();
    const model = readAppModel(modelPath);
    const id = `hyp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const hypothesis: Record<string, unknown> = {
      type: param ? 'param' : 'param',
      id, endpoint, param: param || '', method, technique,
      priority: 5, status: 'running' as const, source: 'strategist' as const, createdAt: Date.now(),
    };
    const existing = Array.isArray(model.hypotheses) ? [...model.hypotheses] : [];
    existing.push(hypothesis);
    updateAppModelSection(modelPath, 'hypotheses', existing, true);

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
      if (srv.isRunning()) {
        oastBaseUrl = `http://localhost:${srv.getPort()}`;
      }
    } catch { /* best effort */ }

    // Check for existing hypothesis with same key — avoid duplicates
    const matchKey = `${method}:${endpoint}:${param || ''}:${technique}`;
    const existingHyps = Array.isArray(model.hypotheses) ? model.hypotheses : [];
    const existingMatch = existingHyps.find((h: any) =>
      `${h.method}:${h.endpoint}:${h.param || ''}:${h.technique}` === matchKey
    );
    if (existingMatch) {
      const existingStatus = (existingMatch as any).status;
      if (existingStatus === 'running') {
        return JSON.stringify({
          status: 'already_running',
          workerId: (existingMatch as any).id,
          technique, endpoint, param: param || '',
          summary: `Worker already running for ${technique} on ${endpoint}${param ? '?'+param : ''}`,
        });
      }
      if (existingStatus === 'done') {
        return JSON.stringify({
          status: 'already_tested',
          workerId: (existingMatch as any).id,
          technique, endpoint, param: param || '',
          summary: `Already tested ${technique} on ${endpoint}${param ? '?'+param : ''}`,
        });
      }
      // pending → repurpose the existing hypothesis
      hypothesis.id = existingMatch.id;
      hypothesis.status = 'running' as const;
      // Update existing pending hypothesis to running
      const updatedHyps = existingHyps.map((h: any) =>
        h.id === hypothesis.id ? { ...h, status: 'running', startedAt: Date.now() } : h
      );
      updateAppModelSection(modelPath, 'hypotheses', updatedHyps, true);
    } else {
      const existing = existingHyps.length ? [...existingHyps] : [];
      existing.push(hypothesis);
      updateAppModelSection(modelPath, 'hypotheses', existing, true);
    }

    function updateHypothesisStatus(status: string, extra?: Record<string, unknown>): void {
      try {
        const cur = readAppModel(modelPath);
        const hyps = Array.isArray(cur.hypotheses) ? [...cur.hypotheses] : [];
        const idx = hyps.findIndex((h: any) => h.id === hypothesis.id);
        if (idx >= 0) {
          (hyps[idx] as Record<string, unknown>).status = status;
          if (extra) Object.assign(hyps[idx] as Record<string, unknown>, extra);
          updateAppModelSection(modelPath, 'hypotheses', hyps, true);
        }
      } catch { /* best effort */ }
    }

    return new Promise((resolve) => {
      const worker = new Worker(workerPath, {
        workerData: {
          hypothesis, llmConfig, appModelPath: modelPath, oastBaseUrl,
          storageStatePath, loginEndpoint, loginMethod, loginFields,
        },
        execArgv: isDev ? ['--import', 'tsx'] : [],
      });
      let resultReceived = false;
      worker.on('message', (result) => {
        resultReceived = true;
        if (result.attempts?.length > 0) {
          updateAppModelSection(modelPath, 'workerActions', result.attempts);
        }
        updateHypothesisStatus('done', {
          completedAt: Date.now(),
          vulnerable: !!result.vulnerable,
          confidence: result.confidence || 0,
        });
        if (result.vulnerable && result.confidence >= 0.5) {
          const cur = readAppModel(modelPath);
          const finding = {
            type: result.technique?.toUpperCase() || 'UNKNOWN',
            endpoint,
            param: param || '',
            evidence: (result.evidence || []).map((e: string) => ({ text: e, type: 'reflection' })),
            confidence: result.confidence >= 0.8 ? 'high' : result.confidence >= 0.5 ? 'medium' : 'low',
            confirmed: true,
            severity: result.confidence >= 0.8 ? 'high' : result.confidence >= 0.5 ? 'medium' : 'low',
          };
          const existing = Array.isArray(cur.findings) ? [...cur.findings] : [];
          existing.push(finding);
          updateAppModelSection(modelPath, 'findings', existing, true);
        }
      });
      worker.on('error', (err) => {
        process.stderr.write(`[spawn_worker] Worker error: ${err.message}\n`);
      });
      worker.on('exit', (code) => {
        if (!resultReceived) {
          updateHypothesisStatus('error', { completedAt: Date.now(), exitCode: code });
        }
        if (code !== 0) process.stderr.write(`[spawn_worker] Worker exited with code ${code}\n`);
      });
      resolve(JSON.stringify({
        status: 'started',
        workerId: hypothesis.id,
        technique,
        endpoint,
        param: param || '',
        summary: `Worker launched for ${technique} on ${endpoint}${param ? '?'+param : ''}`,
      }));
    });
  }, {
    name: 'spawn_worker',
    description: 'Spawn a worker thread to test an endpoint/param with a technique',
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
    const { updateAppModelSection, readAppModel } = await import('../core/app-model');
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
  description: 'Check status of all spawned workers — running count, completed count, pending count, and recent findings. Use this after spawning workers to wait for results before spawning more.',
  tags: ['strategist', 'worker'],
  factory: () => tool(async () => {
    const path = getAppModelPath();
    const model = readAppModel(path);
    const hypotheses = Array.isArray(model.hypotheses) ? model.hypotheses : [];
    const findings = Array.isArray(model.findings) ? model.findings : [];
    let running = 0, pending = 0, done = 0, error = 0;
    for (const h of hypotheses) {
      const status = (h as any).status;
      if (status === 'running') running++;
      else if (status === 'pending') pending++;
      else if (status === 'done') done++;
      else if (status === 'error') error++;
    }
    return JSON.stringify({
      total: hypotheses.length,
      running,
      pending,
      done,
      error,
      findingsCount: findings.length,
      stalled: running === 0 && pending === 0 && error === 0 && done > 0,
      summary: `${running} running, ${pending} pending, ${done} done, ${error} error — ${findings.length} finding(s)`,
    });
  }, {
    name: 'check_workers',
    description: 'Check status of all spawned workers',
    schema: z.object({}),
  }),
});

// ── Ask User Tool ──

toolRegistry.register({
  name: 'ask_user',
  category: 'utility',
  description: 'Ask the user a question and wait for their response. Use when you need credentials, permission, clarification, or want to explain findings.',
  tags: ['utility', 'communication'],
  factory: () => {
    const { createAskUserTool } = require('./ask-user-tool');
    return createAskUserTool();
  },
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
