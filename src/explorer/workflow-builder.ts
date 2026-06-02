import type { DOMSnapshot } from './dom-observer';
import type { CapturedRequest } from './network-recorder';
import type { Interaction } from './interaction-planner';

export interface Transition {
  beforeSnapshot: DOMSnapshot;
  afterSnapshot: DOMSnapshot;
  trigger: Interaction;
  requests: CapturedRequest[];
}

export interface WorkflowNode {
  url: string;
  title: string;
  type: 'page' | 'login' | 'form' | 'api';
  authRequired: boolean;
}

export interface WorkflowEdge {
  from: string;
  to: string;
  trigger: 'click' | 'form_submit' | 'navigate' | 'fill_and_submit';
  label: string;
}

export interface EndpointParam {
  name: string;
  location: 'query' | 'path' | 'body' | 'header';
  value?: string;
}

export interface DiscoveredEndpoint {
  path: string;
  method: string;
  params: EndpointParam[];
  contentType?: string;
  status?: number;
  authRequired: boolean;
  source: 'crawl' | 'request' | 'static';
}

export interface AuthBoundary {
  url: string;
  requiresAuth: boolean;
  evidence: string;
  capturedCredentials?: Record<string, string>;
  sessionCookies?: Record<string, string>;
}

const TECH_SIGNATURES: Array<{ match: (headers: Record<string, string>, body: string | null) => boolean; label: string }> = [
  { match: (h) => /express/i.test(h['x-powered-by'] || ''), label: 'Express.js' },
  { match: (h) => /next/i.test(h['x-powered-by'] || ''), label: 'Next.js' },
  { match: (h) => /phusion|passenger/i.test(h['x-powered-by'] || ''), label: 'Phusion Passenger' },
  { match: (h) => /nginx/i.test(h['server'] || ''), label: 'Nginx' },
  { match: (h) => /apache/i.test(h['server'] || ''), label: 'Apache' },
  { match: (h) => /cloudflare/i.test(h['server'] || ''), label: 'Cloudflare' },
  { match: (h) => /iis/i.test(h['server'] || ''), label: 'IIS' },
  { match: (h) => /envoy/i.test(h['server'] || ''), label: 'Envoy' },
  { match: (h) => /vercel/i.test(h['server'] || ''), label: 'Vercel' },
  { match: (h) => /gae|google\s*frontend/i.test(h['server'] || ''), label: 'Google App Engine' },
  { match: (h) => !!h['x-aspnet-version'] || /asp\.net/i.test(h['x-powered-by'] || ''), label: 'ASP.NET' },
  { match: (h) => /tomcat/i.test(h['server'] || ''), label: 'Tomcat' },
  { match: (h) => /jetty/i.test(h['server'] || ''), label: 'Jetty' },
  { match: (h) => /django/i.test(h['server'] || '') || !!h['x-frame-options'] && /csrftoken/i.test(JSON.stringify(h)), label: 'Django' },
  { match: (h, b) => /laravel/i.test(h['set-cookie'] || '') || /laravel/i.test(h['x-powered-by'] || ''), label: 'Laravel' },
  { match: (h) => /php/i.test(h['x-powered-by'] || ''), label: 'PHP' },
  { match: (h) => !!h['x-amz-request-id'] || !!h['x-amz-id-2'], label: 'AWS S3' },
  { match: (h) => !!h['x-goog-storage-class'], label: 'Google Cloud Storage' },
  { match: (h) => /akamai/i.test(h['server'] || '') || /akamai/i.test(h['x-akamai-request-id'] || ''), label: 'Akamai' },
  { match: (h) => !!h['x-azure-ref'], label: 'Azure' },
  { match: (h) => /fastly/i.test(h['server'] || '') || !!h['x-fastly-request-id'], label: 'Fastly' },
  { match: (h) => !!h['cf-ray'] || !!h['cf-cache-status'], label: 'Cloudflare' },
  { match: (h) => /webpack/i.test(h['x-asset'] || '') || false, label: 'Webpack' },
];

function classifyNodeType(url: string, title: string, snapshot: DOMSnapshot): WorkflowNode['type'] {
  const u = url.toLowerCase();
  const t = title.toLowerCase();
  if (/\/login|\/signin|\/auth|\/session\/new|\/log-in/.test(u) || /sign\s*in|log\s*in|login/.test(t)) {
    return 'login';
  }
  if (snapshot.forms.some((f) => /password/i.test(f.fields.map((x) => x.type + ' ' + x.name).join(' ')))) {
    return 'form';
  }
  if (/\/api\/|\.json$|\/graphql/.test(u)) {
    return 'api';
  }
  return 'page';
}

function requiresAuth(nodeType: WorkflowNode['type'], snapshot: DOMSnapshot): boolean {
  if (nodeType === 'login') return true;
  return snapshot.forms.some((f) =>
    f.fields.some((field) => /password|passwd/i.test(field.type) || /password|passwd/i.test(field.name))
  );
}

function isApiRequest(req: CapturedRequest, target: string): boolean {
  try {
    const reqUrl = new URL(req.url);
    const targetUrl = new URL(target);
    if (reqUrl.origin !== targetUrl.origin) return false;
    if (req.resourceType === 'xhr' || req.resourceType === 'fetch') return true;
    if (reqUrl.pathname.startsWith('/api/') || reqUrl.pathname.startsWith('/graphql')) return true;
    if (/\.json(\?|$)/.test(reqUrl.pathname)) return true;
    const accept = req.requestHeaders['accept'] || '';
    if (/application\/json|application\/graphql/.test(accept)) return true;
    return false;
  } catch {
    return false;
  }
}

function extractPathFromUrl(url: string): string {
  try {
    return new URL(url).pathname;
  } catch {
    return url;
  }
}

function extractQueryParams(url: string): EndpointParam[] {
  try {
    const u = new URL(url);
    const params: EndpointParam[] = [];
    for (const [name, value] of u.searchParams.entries()) {
      params.push({ name, location: 'query', value });
    }
    return params;
  } catch {
    return [];
  }
}

function extractPathParams(path: string): EndpointParam[] {
  const params: EndpointParam[] = [];
  const matches = path.matchAll(/:([a-zA-Z_][a-zA-Z0-9_]*)/g);
  for (const m of matches) {
    params.push({ name: m[1], location: 'path' });
  }
  return params;
}

function extractBodyParams(body: string | null, contentType: string): EndpointParam[] {
  if (!body) return [];
  const params: EndpointParam[] = [];
  if (/application\/json/i.test(contentType)) {
    try {
      const parsed = JSON.parse(body);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        for (const [name, value] of Object.entries(parsed)) {
          params.push({ name, location: 'body', value: typeof value === 'string' ? value : JSON.stringify(value) });
        }
      }
    } catch {
      // not JSON
    }
  } else if (/application\/x-www-form-urlencoded/i.test(contentType)) {
    try {
      const usp = new URLSearchParams(body);
      for (const [name, value] of usp.entries()) {
        params.push({ name, location: 'body', value });
      }
    } catch {
      // not form-urlencoded
    }
  }
  return params;
}

function isAuthEvidence(req: CapturedRequest): { requiresAuth: boolean; evidence: string } | null {
  if (req.status === 401) {
    return { requiresAuth: true, evidence: `401 Unauthorized on ${req.method} ${extractPathFromUrl(req.url)}` };
  }
  if (req.status === 403) {
    return { requiresAuth: true, evidence: `403 Forbidden on ${req.method} ${extractPathFromUrl(req.url)}` };
  }
  const setCookie = req.responseHeaders['set-cookie'];
  if (setCookie) {
    const isSession = /session|token|auth|jwt|sid/i.test(setCookie);
    return { requiresAuth: false, evidence: `Set-Cookie on ${req.method} ${extractPathFromUrl(req.url)}: ${setCookie.slice(0, 80)}` };
  }
  return null;
}

function mapTriggerType(type: Interaction['type']): WorkflowEdge['trigger'] {
  if (type === 'fill_and_submit') return 'form_submit';
  return type;
}

function detectTechStack(transitions: Transition[]): string[] {
  const detected = new Set<string>();
  for (const t of transitions) {
    for (const req of t.requests) {
      const headers = req.responseHeaders || {};
      for (const sig of TECH_SIGNATURES) {
        try {
          if (sig.match(headers, req.responseBody)) {
            detected.add(sig.label);
          }
        } catch {
          // ignore signature errors
        }
      }
    }
  }
  return Array.from(detected).sort();
}

function deduplicateEndpoints(endpoints: DiscoveredEndpoint[]): DiscoveredEndpoint[] {
  const seen = new Map<string, DiscoveredEndpoint>();
  for (const ep of endpoints) {
    const key = `${ep.method.toUpperCase()}:${ep.path}`;
    const existing = seen.get(key);
    if (!existing) {
      seen.set(key, ep);
      continue;
    }
    const mergedParams = [...existing.params];
    for (const p of ep.params) {
      if (!mergedParams.some((m) => m.name === p.name && m.location === p.location)) {
        mergedParams.push(p);
      }
    }
    seen.set(key, {
      ...existing,
      params: mergedParams,
      authRequired: existing.authRequired || ep.authRequired,
      contentType: ep.contentType || existing.contentType,
    });
  }
  return Array.from(seen.values());
}

export function buildWorkflowGraph(
  transitions: Transition[],
  target: string
): {
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
  endpoints: DiscoveredEndpoint[];
  authBoundaries: AuthBoundary[];
  techStack: string[];
} {
  const nodeMap = new Map<string, WorkflowNode>();
  const edges: WorkflowEdge[] = [];
  const endpoints: DiscoveredEndpoint[] = [];
  const authBoundaries: AuthBoundary[] = [];

  const ensureNode = (snap: DOMSnapshot): WorkflowNode => {
    const existing = nodeMap.get(snap.url);
    if (existing) return existing;
    const type = classifyNodeType(snap.url, snap.title, snap);
    const authRequired = requiresAuth(type, snap);
    const node: WorkflowNode = { url: snap.url, title: snap.title, type, authRequired };
    nodeMap.set(snap.url, node);
    return node;
  };

  for (const t of transitions) {
    ensureNode(t.beforeSnapshot);
    ensureNode(t.afterSnapshot);

    edges.push({
      from: t.beforeSnapshot.url,
      to: t.afterSnapshot.url,
      trigger: mapTriggerType(t.trigger.type),
      label: t.trigger.label,
    });

    for (const req of t.requests) {
      if (!isApiRequest(req, target)) continue;

      const path = extractPathFromUrl(req.url);
      const queryParams = extractQueryParams(req.url);
      const pathParams = extractPathParams(path);
      const bodyParams = extractBodyParams(req.requestBody, req.requestHeaders['content-type'] || '');

      const isAuth = isAuthEvidence(req);
      const authRequired = !!isAuth?.requiresAuth;

      endpoints.push({
        path,
        method: req.method,
        params: [...queryParams, ...pathParams, ...bodyParams],
        contentType: req.contentType,
        status: req.status,
        authRequired,
        source: 'request',
      });

      if (isAuth) {
        authBoundaries.push({
          url: req.url,
          requiresAuth: isAuth.requiresAuth,
          evidence: isAuth.evidence,
        });
      }
    }
  }

  if (authBoundaries.length === 0) {
    for (const node of nodeMap.values()) {
      if (node.type === 'login') {
        authBoundaries.push({
          url: node.url,
          requiresAuth: true,
          evidence: `Login form detected at ${node.url}`,
        });
      }
    }
  }

  return {
    nodes: Array.from(nodeMap.values()),
    edges,
    endpoints: deduplicateEndpoints(endpoints),
    authBoundaries,
    techStack: detectTechStack(transitions),
  };
}

function _unused_targetUrl(target: string): { origin: string; path: string } {
  try {
    const u = new URL(target);
    return { origin: u.origin, path: u.pathname };
  } catch {
    return { origin: target, path: '/' };
  }
}
void _unused_targetUrl;

