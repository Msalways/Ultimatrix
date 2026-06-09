import type { GraphNode, GraphEdge, GraphParam } from './types';

interface HarEntry {
  startedDateTime: string;
  time: number;
  request: {
    method: string;
    url: string;
    headers: Array<{ name: string; value: string }>;
    postData?: { mimeType: string; text: string };
    queryString: Array<{ name: string; value: string }>;
    cookies: Array<{ name: string; value: string }>;
  };
  response: {
    status: number;
    statusText: string;
    headers: Array<{ name: string; value: string }>;
    content: { mimeType: string; text?: string; size: number };
    redirectURL?: string;
  };
  pageref?: string;
}

interface HarLog {
  log: {
    entries: HarEntry[];
    pages?: Array<{ id: string; title: string; startedDateTime: string }>;
  };
}

export function parseHarToGraph(harJson: HarLog): { nodes: GraphNode[]; edges: GraphEdge[] } {
  const nodes: GraphNode[] = [];
  const edges: GraphEdge[] = [];
  const seen = new Map<string, number>();
  const idByPage = new Map<string, string>();
  const pageStack: string[] = [];

  if (harJson.log.pages) {
    for (const page of harJson.log.pages) {
      const id = `har-pg-${page.id}`;
      const node: GraphNode = {
        id,
        url: '',
        method: 'GET',
        params: [],
        bodyFields: [],
        requestHeaders: {},
        responseStatus: 200,
        responseHeaders: {},
        contentType: 'text/html',
        cookies: {},
        source: 'har',
        tags: ['page-start'],
        observations: [],
        attackResults: [],
        depth: 0,
        title: page.title || '',
      };
      nodes.push(node);
      idByPage.set(page.id, id);
      pageStack.push(id);
    }
  }

  for (const entry of harJson.log.entries) {
    const req = entry.request;
    const res = entry.response;
    const url = new URL(req.url);

    const key = `${req.method}:${url.pathname}`;
    const existingIdx = seen.get(key);

    const params: GraphParam[] = req.queryString.map((q) => ({
      name: q.name,
      in: 'query' as const,
      type: 'string',
      value: q.value,
      required: false,
    }));

    const bodyFields: GraphParam[] = [];
    if (req.postData) {
      const ct = req.postData.mimeType || '';
      if (ct.includes('json')) {
        try {
          const parsed = JSON.parse(req.postData.text);
          for (const [k, v] of Object.entries(parsed)) {
            bodyFields.push({
              name: k, in: 'body', type: Array.isArray(v) ? 'array' : typeof v,
              value: typeof v === 'string' ? v : JSON.stringify(v).slice(0, 200),
              required: false,
            });
          }
        } catch {
          bodyFields.push({ name: 'raw-body', in: 'body', type: 'text', value: req.postData.text.slice(0, 500), required: false });
        }
      } else if (ct.includes('form')) {
        const fParams = new URLSearchParams(req.postData.text);
        for (const [k, v] of fParams) {
          bodyFields.push({ name: k, in: 'body', type: 'form-field', value: v, required: false });
        }
      }
    }

    const headers: Record<string, string> = {};
    for (const h of req.headers) headers[h.name] = h.value;
    const resHeaders: Record<string, string> = {};
    for (const h of res.headers) resHeaders[h.name] = h.value;

    const tags: string[] = [];
    if (res.status === 401 || res.status === 403) tags.push('auth-required');
    if (res.status >= 200 && res.status < 300) tags.push('success');
    if (params.length > 0 || bodyFields.length > 0) tags.push('has-params');
    if (res.content.mimeType.includes('json')) tags.push('returns-json');
    if (res.content.mimeType.includes('html')) tags.push('returns-html');
    if (res.content.text && params.some((p) => res.content.text!.includes(p.value ?? ''))) tags.push('reflects-input');

    const node: GraphNode = {
      id: `har-${key.replace(/[^a-zA-Z0-9]/g, '_')}${existingIdx !== undefined ? `_${existingIdx}` : ''}`,
      url: req.url,
      method: req.method,
      params,
      bodyFields,
      requestHeaders: headers,
      requestBody: req.postData?.text,
      responseStatus: res.status,
      responseHeaders: resHeaders,
      responseBodyPreview: res.content.text?.slice(0, 2000),
      contentType: res.content.mimeType,
      cookies: Object.fromEntries(req.cookies.map((c) => [c.name, c.value])),
      source: 'har',
      tags,
      observations: [],
      attackResults: [],
      depth: 0,
      title: req.url,
    };

    if (existingIdx !== undefined) {
      const existing = nodes[existingIdx];
      for (const p of params) {
        if (!existing.params.some((ep) => ep.name === p.name)) existing.params.push(p);
      }
      if (req.postData && !existing.requestBody) existing.requestBody = req.postData.text;
      continue;
    }

    seen.set(key, nodes.length);
    nodes.push(node);

    const pageId = entry.pageref ? idByPage.get(entry.pageref) : null;
    if (pageId) {
      let trigger: GraphEdge['trigger'] = 'navigation';
      if (req.method !== 'GET') trigger = 'form_submit';
      edges.push({ fromId: pageId, toId: node.id, trigger, label: `har: ${req.method} ${url.pathname}` });
    } else if (pageStack.length > 0) {
      const prev = pageStack[pageStack.length - 1];
      if (res.redirectURL) {
        edges.push({ fromId: prev, toId: node.id, trigger: 'redirect', label: `redirect: ${url.pathname}` });
      }
    }

    if (res.redirectURL) {
      pageStack.push(node.id);
    }
  }

  return { nodes, edges };
}

export function mergeHarIntoGraph(
  harPath: string,
  existingNodes: GraphNode[],
  existingEdges: GraphEdge[],
): { nodes: GraphNode[]; edges: GraphEdge[] } {
  try {
    const raw = require('fs').readFileSync(harPath, 'utf-8');
    const parsed: HarLog = JSON.parse(raw);
    const { nodes: harNodes, edges: harEdges } = parseHarToGraph(parsed);
    const mergedNodes = [...existingNodes];
    const mergedEdges = [...existingEdges];
    const seen = new Set(existingNodes.map((n) => `${n.method}:${n.url}`));
    for (const n of harNodes) {
      const key = `${n.method}:${n.url}`;
      if (!seen.has(key)) {
        seen.add(key);
        mergedNodes.push(n);
      }
    }
    const edgeKeys = new Set(mergedEdges.map((e) => `${e.fromId}|${e.toId}|${e.trigger}`));
    for (const e of harEdges) {
      const key = `${e.fromId}|${e.toId}|${e.trigger}`;
      if (!edgeKeys.has(key)) {
        edgeKeys.add(key);
        mergedEdges.push(e);
      }
    }
    return { nodes: mergedNodes, edges: mergedEdges };
  } catch {
    return { nodes: existingNodes, edges: existingEdges };
  }
}
