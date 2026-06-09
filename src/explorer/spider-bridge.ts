import type { AppModel, WorkflowNode, WorkflowEdge, AppModelForm, AppModelEndpoint } from '../core/app-model';
import type { CrawlResult } from './spider';
import type { TraceEntry } from '../core/browser-session';
import { getGlobalGraphStore } from '../workflow-graph/store';
import type { GraphNode, GraphEdge, GraphParam } from '../workflow-graph/types';

const STATIC_EXT = /\.(css|js|woff2?|png|svg|ico|map|jpg|jpeg|gif|webp|ttf|eot|pdf)$/i;

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

function traceEntryToGraphNode(entry: TraceEntry): GraphNode | null {
  if (entry.type !== 'xhr' && entry.type !== 'fetch' && entry.type !== 'navigation' && entry.type !== 'form') return null;
  try { new URL(entry.url); } catch { return null; }
  if (STATIC_EXT.test(entry.url)) return null;
  const CHALLENGE_PATHS = /^\/(cdn-cgi|__cf|__static)\//;
  try {
    const p = new URL(entry.url).pathname;
    if (CHALLENGE_PATHS.test(p)) return null;
  } catch { return null; }

  const params: GraphParam[] = [];
  try {
    const u = new URL(entry.url);
    u.searchParams.forEach((v, k) => params.push({ name: k, in: 'query', type: 'string', value: v, required: false }));
  } catch { /* ignore */ }

  const bodyFields: GraphParam[] = [];
  const reqCt = (entry.requestHeaders?.['content-type'] || '').toLowerCase();
  const respCt = (entry.responseHeaders?.['content-type'] || '').toLowerCase();
  if (entry.requestBody) {
    const { fields } = parseBodyFields(entry.requestBody, reqCt);
    for (const f of fields) {
      bodyFields.push({ name: f.name, in: 'body', type: f.type, value: undefined, required: false });
    }
  }

  const tags: string[] = [];
  if (entry.status === 401 || entry.status === 403) tags.push('auth-required');
  if (params.length > 0 || bodyFields.length > 0) tags.push('has-params');
  if (respCt.includes('json')) tags.push('returns-json');
  if (respCt.includes('html')) tags.push('returns-html');

  return {
    id: '',
    url: entry.url,
    method: entry.method,
    params,
    bodyFields,
    requestHeaders: entry.requestHeaders || {},
    requestBody: entry.requestBody,
    responseStatus: entry.status,
    responseHeaders: entry.responseHeaders || {},
    responseBodyPreview: entry.responseBody?.slice(0, 2000),
    contentType: respCt || 'application/octet-stream',
    cookies: {},
    source: 'crawl',
    tags,
    observations: [],
    attackResults: [],
    depth: 0,
    title: entry.url,
  };
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
  for (const form of forms) {
    let path: string;
    try { path = new URL(form.action, form.pageUrl).pathname; } catch { continue; }
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

function graphNodeToEndpoint(n: GraphNode): AppModelEndpoint {
  const bodyFields = n.bodyFields.map((f) => ({ name: f.name, type: f.type }));
  let bodyFormat: AppModelEndpoint['bodyFormat'];
  const ct = n.contentType.toLowerCase();
  if (ct.includes('json')) bodyFormat = 'json';
  else if (ct.includes('xml')) bodyFormat = 'xml';
  else if (ct.includes('graphql')) bodyFormat = 'graphql';
  else if (ct.includes('form')) bodyFormat = 'form';
  else bodyFormat = undefined;

  let path: string;
  try { path = new URL(n.url).pathname; } catch { path = n.url; }

  const params = n.params.map((p) => ({ name: p.name, type: p.in, required: p.required }));
  for (const f of n.bodyFields) {
    if (!params.some((p) => p.name === f.name)) params.push({ name: f.name, type: 'body', required: f.required });
  }

  return {
    path,
    method: n.method,
    params,
    requiresAuth: n.tags.includes('auth-required'),
    responseStatus: n.responseStatus,
    contentType: n.contentType,
    bodyPreview: n.requestBody || '',
    bodyFormat,
    bodyFields: bodyFields.length > 0 ? bodyFields : undefined,
    authHeaders: extractAuthHeaders(n.requestHeaders),
  };
}

export function spiderResultToAppModel(crawl: CrawlResult, target: string): SpiderBridgeResult {
  const store = getGlobalGraphStore();
  store.setTarget(target);

  const workflowNodes: WorkflowNode[] = [];
  const workflowEdges: WorkflowEdge[] = [];
  const forms: AppModelForm[] = [];
  let privateAppHint = '';

  // Phase 1: Ingest crawl routes as graph nodes
  for (const route of crawl.routes) {
    const nodeId = `spider-${route.path.replace(/[^a-zA-Z0-9]/g, '_') || 'root'}`;
    const isLogin = /login|auth|signin|logon/.test(route.path);
    const node = store.upsertNode('GET', route.url, {
      id: nodeId,
      responseStatus: route.status ?? 200,
      contentType: route.contentType ?? 'text/html',
      responseBodyPreview: route.bodyPreview,
      source: 'crawl',
      tags: isLogin ? ['login'] : [],
      depth: route.depth ?? 0,
      title: route.title || route.url,
      params: [],
      bodyFields: [],
      requestHeaders: {},
      responseHeaders: {},
      cookies: {},
      observations: [],
      attackResults: [],
    });
    workflowNodes.push({
      id: node.id,
      url: route.url,
      title: route.title,
      type: isLogin ? 'login' : 'page',
      authRequired: false,
      authVerified: false,
      discoveredFrom: null,
      discoveryMethod: 'navigation',
    });

    // Extract forms from DOM snapshots
    const snapshot = crawl.snapshots.find(s => s.url === route.url);
    if (snapshot) {
      for (const f of snapshot.forms) {
        const exists = forms.some((ef) => ef.pageUrl === snapshot!.url && ef.action === f.action);
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

      // Form nodes → graph edges
      for (const f of snapshot.forms) {
        const formParams: GraphParam[] = f.fields.map((field) => ({
          name: field.name,
          in: 'body' as const,
          type: field.type,
          required: field.required,
        }));
        let actionPath: string;
        try { actionPath = new URL(f.action, route.url).href; } catch { actionPath = f.action; }
        const formNode = store.upsertNode(f.method.toUpperCase(), actionPath, {
          bodyFields: formParams,
          tags: ['form', 'has-params'],
          source: 'crawl',
          depth: route.depth! + 1,
          title: `form @ ${f.selector || f.action}`,
        });
        store.addEdge({
          fromId: node.id,
          toId: formNode.id,
          trigger: 'form_submit',
          selector: f.selector,
          formData: Object.fromEntries(f.fields.map((field) => [field.name, field.placeholder || ''])),
          label: `form-submit: ${f.selector || f.action}`,
        });
      }
    }
  }

  // Phase 2: Ingest trace entries as graph nodes + edges
  for (const entry of crawl.trace || []) {
    const gNode = traceEntryToGraphNode(entry);
    if (!gNode) continue;
    const key = `${entry.method}:${entry.url}`;
    const existing = store.findNodeByUrl(entry.method, entry.url);
    if (existing) {
      for (const p of gNode.params) {
        if (!existing.params.some((ep) => ep.name === p.name)) existing.params.push(p);
      }
      for (const p of gNode.bodyFields) {
        if (!existing.bodyFields.some((ep) => ep.name === p.name)) existing.bodyFields.push(p);
      }
      if (entry.responseBody && !existing.responseBodyPreview) {
        existing.responseBodyPreview = entry.responseBody.slice(0, 2000);
      }
      continue;
    }

    gNode.id = `cr-${key.replace(/[^a-zA-Z0-9]/g, '_')}`;
    store.addNode(gNode);

    if (entry.parentNodeId && store.getNode(entry.parentNodeId)) {
      store.addEdge({
        fromId: entry.parentNodeId,
        toId: gNode.id,
        trigger: entry.triggerType === 'xhr-js' ? 'script' : (entry.triggerType || 'navigation') as GraphEdge['trigger'],
        selector: entry.triggerSelector,
        formData: entry.triggerPayload ? { payload: entry.triggerPayload } : undefined,
        label: `${entry.method} ${entry.url}`,
      });
    }
  }

  // Phase 3: Build edges from crawl depth transitions
  const sorted = [...crawl.routes].sort((a, b) => a.visitedAt - b.visitedAt);
  for (let i = 1; i < sorted.length; i++) {
    const prev = sorted[i - 1];
    const curr = sorted[i];
    const fromNode = store.findNodeByUrl('GET', prev.url);
    const toNode = store.findNodeByUrl('GET', curr.url);
    if (fromNode && toNode && fromNode.id !== toNode.id) {
      store.addEdge({
        fromId: fromNode.id,
        toId: toNode.id,
        trigger: 'navigation',
        label: `spider depth ${curr.depth}`,
      });
    }
  }

  // Private app detection
  if (crawl.visitedUrls.length <= 1 && crawl.routes.length <= 1) {
    privateAppHint = 'Only one page discovered — likely behind authentication';
  } else if (crawl.routes.length <= 2 && Object.keys(crawl.cookies).length === 0) {
    privateAppHint = 'Few routes and no cookies — may require login';
  }

  const hasSessionCookie = Object.keys(crawl.cookies).some(
    (k) => /session|token|auth|sid|jwt|connect\.sid|phpsessid|jsessionid/i.test(k)
  );

  // Derive endpoint list from graph nodes (backward compat)
  const allNodes = store.getAllNodes();
  const allEdges = store.getAllEdges();
  const allEndpoints = allNodes.map(graphNodeToEndpoint);

  // Re-derive workflow nodes/edges from graph store for consistency
  const sortedNodes = allNodes.sort((a, b) => a.depth - b.depth);
  for (const gn of sortedNodes) {
    if (gn.source === 'crawl' && !workflowNodes.some((wn) => wn.url === gn.url)) {
      let wfType = 'page';
      if (gn.tags.includes('login')) wfType = 'login';
      else if (gn.tags.includes('form')) wfType = 'form';
      else if (gn.method !== 'GET') wfType = 'api';
      workflowNodes.push({
        id: gn.id,
        url: gn.url,
        title: gn.title || gn.url,
        type: wfType === 'form' ? 'page' : wfType as 'page' | 'api' | 'login',
        authRequired: gn.tags.includes('auth-required'),
        authVerified: false,
        discoveredFrom: null,
        discoveryMethod: 'navigation',
      });
    }
  }
  for (const ge of allEdges) {
    if (!workflowEdges.some((we) => we.fromId === ge.fromId && we.toId === ge.toId)) {
      workflowEdges.push({
        fromId: ge.fromId,
        toId: ge.toId,
        trigger: ge.trigger as WorkflowEdge['trigger'],
        label: ge.label,
      });
    }
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
      workflow: { nodes: workflowNodes, edges: workflowEdges },
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
