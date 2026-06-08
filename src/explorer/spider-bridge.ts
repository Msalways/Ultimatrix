import type { AppModel, WorkflowNode, WorkflowEdge, AppModelForm, AppModelEndpoint } from '../core/app-model';
import type { CrawlResult } from './spider';
import type { TraceEntry } from '../core/browser-session';

const STATIC_EXT = /\.(css|js|woff2?|png|svg|ico|map|jpg|jpeg|gif|webp|ttf|eot|pdf)$/i;
const API_CONTENT_TYPES = /json|xml|grpc|protobuf|graphql|form-data|x-www-form-urlencoded/i;

export interface SpiderBridgeResult {
  model: Partial<AppModel>;
  privateAppHint: string;
}

function parseBodyFields(body: string | undefined, contentType: string): { format: AppModelEndpoint['bodyFormat']; fields: Array<{ name: string; type: string }> } {
  if (!body) return { format: undefined, fields: [] };
  const ct = contentType || '';
  try {
    if (ct.includes('json')) {
      const parsed = JSON.parse(body);
      if (typeof parsed === 'object' && parsed !== null) {
        const fields = Object.entries(parsed).map(([k, v]) => ({
          name: k,
          type: Array.isArray(v) ? 'array' : typeof v === 'object' ? 'object' : typeof v,
        }));
        return { format: 'json', fields };
      }
    }
    if (ct.includes('xml') || ct.includes('soap')) {
      const tags = body.match(/<(\w+)[^>]*>/g) || [];
      const fields = [...new Set(tags.map(t => t.replace(/[<>/]/g, '').split(/\s/)[0]))]
        .filter(t => !['xml', 'soap', 'env', 'body'].includes(t.toLowerCase()))
        .map(t => ({ name: t, type: 'xml-element' }));
      return { format: 'xml', fields };
    }
    if (ct.includes('graphql')) {
      const opMatch = body.match(/(query|mutation)\s+(\w+)/i);
      const field = opMatch ? opMatch[2] : 'query';
      const vars = body.match(/\$(\w+)/g) || [];
      const fields = vars.map(v => ({ name: v.replace('$', ''), type: 'graphql-variable' }));
      if (!fields.length) fields.push({ name: field, type: 'graphql-operation' });
      return { format: 'graphql', fields };
    }
    if (ct.includes('form-urlencoded') || ct.includes('form-data')) {
      const params = new URLSearchParams(body);
      const fields = [...params.keys()].map(k => ({ name: k, type: 'form-field' }));
      return { format: 'form', fields };
    }
  } catch { /* best-effort parse */ }

  // Fallback: try to parse as JSON regardless of content-type
  try {
    const parsed = JSON.parse(body);
    if (typeof parsed === 'object' && parsed !== null) {
      const fields = Object.entries(parsed).map(([k, v]) => ({
        name: k,
        type: Array.isArray(v) ? 'array' : typeof v === 'object' ? 'object' : typeof v,
      }));
      return { format: 'json', fields };
    }
  } catch {}

  return { format: undefined, fields: [] };
}

function extractAuthHeaders(reqHeaders: Record<string, string>): Record<string, string> | undefined {
  const auth: Record<string, string> = {};
  for (const [k, v] of Object.entries(reqHeaders || {})) {
    const lk = k.toLowerCase();
    if (lk === 'authorization') auth.authorization = v;
    else if (lk === 'cookie') auth.cookie = v;
    else if (lk === 'x-api-key') auth['x-api-key'] = v;
    else if (lk === 'x-auth-token') auth['x-auth-token'] = v;
  }
  return Object.keys(auth).length > 0 ? auth : undefined;
}

function mineTraceForEndpoints(trace: TraceEntry[]): AppModelEndpoint[] {
  const seen = new Map<string, number>();
  const endpoints: AppModelEndpoint[] = [];

  for (const entry of trace) {
    // Include navigation entries — iframe form submissions and page
    // navigations carry query params in the URL that XSS/SSRF primitives
    // need to target. Entries without params/body are filtered later.
    if (entry.type !== 'xhr' && entry.type !== 'fetch' && entry.type !== 'navigation' && entry.type !== 'form') continue;

    let url: URL;
    try {
      url = new URL(entry.url);
    } catch {
      continue;
    }

    const pathname = url.pathname;
    if (STATIC_EXT.test(pathname)) continue;

    const CHALLENGE_PATHS = /^\/(cdn-cgi|__cf|__static)\//;
    if (CHALLENGE_PATHS.test(pathname)) continue;

    const reqContentType = (entry.requestHeaders?.['content-type'] || entry.requestHeaders?.['Content-Type'] || '').toLowerCase();
    const respContentType = (entry.responseHeaders?.['content-type'] || '').toLowerCase();

    const params: Array<{ name: string; type: string; required: boolean }> = [];
    url.searchParams.forEach((_, key) => {
      params.push({ name: key, type: 'query', required: false });
    });

    // Parse request body for fields + format
    const { format, fields } = parseBodyFields(entry.requestBody, reqContentType);
    for (const f of fields) {
      const exists = params.some(p => p.name === f.name);
      if (!exists) params.push({ name: f.name, type: 'body', required: false });
    }

    const uniqueKey = `${entry.method}:${pathname}`;

    // Phase 1B: merge params from subsequent trace entries into existing
    // endpoint instead of dropping them. A form submission POST may carry
    // different fields than an earlier XHR POST to the same endpoint.
    const existingIdx = seen.get(uniqueKey);
    if (existingIdx !== undefined) {
      const existing = endpoints[existingIdx];
      for (const p of params) {
        if (!existing.params.some(ep => ep.name === p.name)) {
          existing.params.push(p);
        }
      }
      // Also merge body fields from the later entry if the format is consistent
      if (entry.requestBody && existing.bodyPreview !== entry.requestBody) {
        const bodyLen = existing.bodyPreview?.length ?? 0;
        const newLen = entry.requestBody.length;
        // Keep the longer body preview (more complete request)
        if (newLen > bodyLen) existing.bodyPreview = entry.requestBody;
      }
      continue;
    }

    seen.set(uniqueKey, endpoints.length);

    // Detect auth from request headers or response status
    const authHeaders = extractAuthHeaders(entry.requestHeaders);
    const requiresAuth = !!(authHeaders || entry.status === 401 || entry.status === 403);

    endpoints.push({
      path: pathname,
      method: entry.method || 'GET',
      params,
      requiresAuth,
      responseStatus: entry.status,
      contentType: respContentType,
      bodyPreview: entry.requestBody || '',
      bodyFormat: format,
      bodyFields: fields.length > 0 ? fields : undefined,
      authHeaders,
    });
  }

  return endpoints;
}

const TECHNIQUES = ['sqli', 'xss', 'ssrf'] as const;

function buildInitialHypotheses(
  endpoints: AppModelEndpoint[],
  forms: AppModelForm[],
): Record<string, unknown>[] {
  const hypotheses: Record<string, unknown>[] = [];

  for (const ep of endpoints) {
    for (const param of ep.params) {
      for (const technique of TECHNIQUES) {
        hypotheses.push({
          type: 'param',
          id: `${technique}-${ep.method}-${ep.path}-${param.name}`,
          endpoint: ep.path,
          param: param.name,
          method: ep.method,
          technique,
          priority: 5,
          status: 'pending',
          source: 'spider',
          createdAt: Date.now(),
        });
      }
    }
  }

  // For forms that didn't map to endpoints (no params), still create hypotheses
  for (const form of forms) {
    let path: string;
    try {
      path = new URL(form.action, form.pageUrl).pathname;
    } catch {
      continue;
    }
    const method = form.method.toUpperCase();
    for (const field of form.fields) {
      const epExists = endpoints.some(
        (e) => e.method === method && e.path === path && e.params.some((p) => p.name === field.name),
      );
      if (epExists) continue;
      for (const technique of TECHNIQUES) {
        hypotheses.push({
          type: 'param',
          id: `${technique}-${method}-${path}-${field.name}`,
          endpoint: path,
          param: field.name,
          method,
          technique,
          priority: 3,
          status: 'pending',
          source: 'spider',
          createdAt: Date.now(),
        });
      }
    }
  }

  return hypotheses;
}

function formsToEndpoints(forms: AppModelForm[]): AppModelEndpoint[] {
  const seen = new Set<string>();
  const endpoints: AppModelEndpoint[] = [];

  for (const form of forms) {
    let path: string;
    try {
      path = new URL(form.action, form.pageUrl).pathname;
    } catch {
      continue;
    }

    if (STATIC_EXT.test(path)) continue;

    const method = form.method.toUpperCase();
    const key = `${method}:${path}`;
    if (seen.has(key)) continue;
    seen.add(key);

    endpoints.push({
      path,
      method,
      params: form.fields.map((f) => ({
        name: f.name,
        type: method === 'GET' ? 'query' : 'form',
        required: f.required ?? false,
      })),
      requiresAuth: false,
      responseStatus: 0,
      contentType: '',
      bodyPreview: '',
    });
  }

  return endpoints;
}

export function spiderResultToAppModel(crawl: CrawlResult, target: string): SpiderBridgeResult {
  const nodes: WorkflowNode[] = [];
  const edges: WorkflowEdge[] = [];
  const forms: AppModelForm[] = [];
  let privateAppHint = '';

  // Convert routes to workflow nodes
  for (const route of crawl.routes) {
    const nodeId = `spider-${route.path.replace(/[^a-zA-Z0-9]/g, '_') || 'root'}`;
    const isLogin = /login|auth|signin|logon/.test(route.path);
    nodes.push({
      id: nodeId,
      url: route.url,
      title: route.title,
      type: isLogin ? 'login' : 'page',
      authRequired: false,
      authVerified: false,
      discoveredFrom: null,
      discoveryMethod: 'navigation',
    });

    // Convert forms from DOM snapshots
    const snapshot = crawl.snapshots.find(s => s.url === route.url);
    if (snapshot) {
      for (const f of snapshot.forms) {
        const exists = forms.some(
          (ef) => ef.pageUrl === snapshot.url && ef.action === f.action
        );
        if (!exists) {
          forms.push({
            pageUrl: snapshot.url,
            action: f.action,
            method: f.method,
            fields: f.fields.map((field) => ({
              name: field.name,
              type: field.type,
              placeholder: field.placeholder,
              required: field.required,
            })),
          });
        }
      }
      // Treat standalone inputs as virtual forms (no wrapping <form> tag)
      for (const inp of snapshot.inputs) {
        const fieldName = inp.resolvedParam || inp.name;
        if (!fieldName) continue;
        const actionUrl = snapshot.url;
        const exists = forms.some(
          (ef) => ef.pageUrl === snapshot.url && ef.action === actionUrl && ef.fields.some(f => f.name === fieldName)
        );
        if (!exists) {
          forms.push({
            pageUrl: snapshot.url,
            action: actionUrl,
            method: 'GET',
            fields: [{
              name: fieldName,
              type: inp.type,
              placeholder: inp.placeholder || '',
              required: false,
            }],
          });
        }
      }
    }
  }

  // Build edges from depth transitions
  const sorted = [...crawl.routes].sort((a, b) => a.visitedAt - b.visitedAt);
  for (let i = 1; i < sorted.length; i++) {
    const prev = sorted[i - 1];
    const curr = sorted[i];
    const fromNode = nodes.find(
      (n) => n.url === prev.url || n.url.replace(/\/$/, '') === prev.url.replace(/\/$/, '')
    );
    const toNode = nodes.find(
      (n) => n.url === curr.url || n.url.replace(/\/$/, '') === curr.url.replace(/\/$/, '')
    );
    if (fromNode && toNode && fromNode.id !== toNode.id) {
      const exists = edges.some((e) => e.fromId === fromNode.id && e.toId === toNode.id);
      if (!exists) {
        edges.push({
          fromId: fromNode.id,
          toId: toNode.id,
          trigger: 'navigation',
          label: `spider depth ${curr.depth}`,
        });
      }
    }
  }

  // Private app detection
  if (crawl.visitedUrls.length <= 1 && crawl.routes.length <= 1) {
    privateAppHint = 'Only one page discovered — likely behind authentication';
  } else if (crawl.routes.length <= 2 && Object.keys(crawl.cookies).length === 0) {
    privateAppHint = 'Few routes and no cookies — may require login';
  }

  // Cookies present but no session cookie → partial auth
  const hasSessionCookie = Object.keys(crawl.cookies).some(
    (k) => /session|token|auth|sid|jwt|connect\.sid|phpsessid|jsessionid/i.test(k)
  );

  const minedEndpoints = mineTraceForEndpoints(crawl.trace || []);
  const formEndpoints = formsToEndpoints(forms);

  // Merge endpoints: prefer mined (has response data) over form-created
  // Filter out trace-only endpoints with no params — they're likely resource/favicon fetches
  const formActionPaths = new Set(formEndpoints.map(e => `${e.method}:${e.path}`));
  const routePaths = new Set(crawl.routes.map(r => r.path));
  const routePreviewByPath = new Map<string, { bodyPreview: string; contentType: string; status: number }>();
  for (const r of crawl.routes) {
    if (r.bodyPreview) {
      routePreviewByPath.set(r.path, {
        bodyPreview: r.bodyPreview,
        contentType: r.contentType ?? '',
        status: r.status ?? 0,
      });
    }
  }
  const endpointSeen = new Set<string>();
  const allEndpoints: AppModelEndpoint[] = [];
  for (const ep of [...minedEndpoints, ...formEndpoints]) {
    const key = `${ep.method}:${ep.path}`;
    // Bug 5: when the same (method, path) appears in both the trace-mined
    // list (params=[]) and the form-derived list (params=[{name: 'query'}]),
    // the trace entry wins on the first pass and the form params are
    // dropped. This is why an XSS like xss-game (form `name="query"` on
    // `/level1/frame`) ends up with `params: []` and the codegen can't
    // reproduce the vuln. Merge form params INTO the existing endpoint
    // when we see a later entry for the same key.
    if (endpointSeen.has(key)) {
      const existing = allEndpoints.find((e) => `${e.method}:${e.path}` === key);
      if (existing) {
        for (const p of ep.params) {
          if (!existing.params.some((ep) => ep.name === p.name)) {
            existing.params.push(p);
          }
        }
      }
      continue;
    }
    // Skip trace-only endpoints with no params and no body — likely resource fetches
    if (ep.params.length === 0 && !ep.bodyFields?.length
        && !formActionPaths.has(key) && !routePaths.has(ep.path)) {
      continue;
    }
    endpointSeen.add(key);
    // Inject body preview from the route's actual rendered DOM (much richer than request body)
    const routeMeta = routePreviewByPath.get(ep.path);
    if (routeMeta) {
      if (!ep.bodyPreview || ep.bodyPreview.length < 50) {
        ep.bodyPreview = routeMeta.bodyPreview;
      }
      if (routeMeta.contentType && !ep.contentType) {
        ep.contentType = routeMeta.contentType;
      }
      if (routeMeta.status && !ep.responseStatus) {
        ep.responseStatus = routeMeta.status;
      }
    }
    allEndpoints.push(ep);
  }

  // Content score routes → classify rich vs thin
  const thinRoutes: Array<{
    url: string; path: string; title: string;
    initialScore: number; snapshotHash: string; discoveredAt: number;
  }> = [];

  for (const route of crawl.routes) {
    const snap = crawl.snapshots.find(s => s.url === route.url);
    if (!snap) continue;
    const traceCalls = (crawl.trace || []).filter(
      t => t.sourcePage === route.url && (t.type === 'xhr' || t.type === 'fetch')
    ).length;
    const score = snap.forms.length * 10
      + snap.inputs.length * 8
      + snap.interactive.length * 3
      + snap.textContent.length / 200
      + (traceCalls > 0 ? 15 : 0);
    if (score < 10) {
      thinRoutes.push({
        url: route.url,
        path: route.path,
        title: route.title,
        initialScore: score,
        snapshotHash: snap.hash,
        discoveredAt: route.visitedAt,
      });
    }
  }

  return {
    model: {
      target,
      techStack: crawl.techStack || [],
      auth: {
        type: hasSessionCookie ? 'session' : 'unknown',
        loginEndpoint: crawl.loginEndpoint || '',
        endpoints: [],
        cookies: crawl.cookies,
        tokens: [],
        sessions: {},
        storageStatePath: crawl.storageStatePath || undefined,
        loginMethod: crawl.loginMethod || undefined,
        loginFields: crawl.loginFields?.length ? crawl.loginFields : undefined,
        capturedAt: crawl.storageStatePath ? Date.now() : undefined,
      },
      workflow: { nodes, edges },
      endpoints: allEndpoints,
      forms,
      scripts: [],
      cookies: crawl.cookies,
      localStorage: crawl.localStorage,
      findings: [],
      verifications: [],
      parameterClassifications: [],
      authBoundaries: [],
      recordedSessions: {
        'spider-auto': crawl.recording || [],
      },
      hypotheses: buildInitialHypotheses(allEndpoints, forms),
      nextSteps: [
        'Read workflow graph',
        'Probe auth boundaries',
        'Test discovered endpoints',
      ],
      visitedUrls: crawl.visitedUrls || [],
      oastCallbacks: [],
      coverage: [],
      thinRoutes,
    },
    privateAppHint,
  };
}
