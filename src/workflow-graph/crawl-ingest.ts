import type { GraphNode, GraphEdge, GraphParam } from './types';
import type { CrawlResult } from '../explorer/spider';
import type { TraceEntry } from '../core/browser-session';
import type { DOMSnapshot } from '../explorer/dom-observer';

const STATIC_EXT = /\.(css|js|woff2?|png|svg|ico|map|jpg|jpeg|gif|webp|ttf|eot|pdf)$/i;

function traceEntryToNode(entry: TraceEntry): GraphNode | null {
  try {
    const url = new URL(entry.url);
  } catch {
    return null;
  }
  if (STATIC_EXT.test(entry.url)) return null;

  const params: GraphParam[] = [];
  try {
    const u = new URL(entry.url);
    u.searchParams.forEach((v, k) => {
      params.push({ name: k, in: 'query', type: 'string', value: v, required: false });
    });
  } catch { /* ignore */ }

  const bodyFields: GraphParam[] = [];
  if (entry.requestBody) {
    const ct = (entry.requestHeaders?.['content-type'] || '').toLowerCase();
    if (ct.includes('json')) {
      try {
        const parsed = JSON.parse(entry.requestBody);
        for (const [k, v] of Object.entries(parsed)) {
          bodyFields.push({
            name: k, in: 'body', type: Array.isArray(v) ? 'array' : typeof v,
            value: typeof v === 'string' ? v : JSON.stringify(v).slice(0, 200),
            required: false,
          });
        }
      } catch { /* ignore */ }
    } else if (ct.includes('form')) {
      const sp = new URLSearchParams(entry.requestBody);
      for (const [k, v] of sp) {
        bodyFields.push({ name: k, in: 'body', type: 'form-field', value: v, required: false });
      }
    }
  }

  const tags: string[] = [];
  if (entry.status === 401 || entry.status === 403) tags.push('auth-required');
  if (params.length > 0 || bodyFields.length > 0) tags.push('has-params');
  const ct = (entry.responseHeaders?.['content-type'] || '').toLowerCase();
  if (ct.includes('json')) tags.push('returns-json');
  if (ct.includes('html')) tags.push('returns-html');
  if (entry.responseBody && params.some((p) => entry.responseBody!.includes(p.value ?? ''))) {
    tags.push('reflects-input');
  }

  const triggerType = entry.triggerType || (entry.type === 'navigation' ? 'navigation' : 'xhr-js');

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
    contentType: ct || 'application/octet-stream',
    cookies: {},
    source: 'crawl',
    tags,
    observations: [],
    attackResults: [],
    depth: 0,
    title: entry.url,
  };
}

export function mergeCrawlTraceIntoGraph(
  trace: TraceEntry[],
  existingNodes: GraphNode[],
  existingEdges: GraphEdge[],
): { nodes: GraphNode[]; edges: GraphEdge[] } {
  const nodes = [...existingNodes];
  const edges = [...existingEdges];
  const seen = new Set(nodes.map((n) => `${n.method}:${n.url}`));
  const idMap = new Map<string, string>(); // url → nodeId
  for (const n of nodes) idMap.set(`${n.method}:${n.url}`, n.id);

  for (const entry of trace) {
    const node = traceEntryToNode(entry);
    if (!node) continue;

    const key = `${entry.method}:${entry.url}`;
    if (seen.has(key)) {
      const existing = nodes.find((n) => `${n.method}:${n.url}` === key);
      if (existing) {
        for (const p of node.params) {
          if (!existing.params.some((ep) => ep.name === p.name)) existing.params.push(p);
        }
        for (const p of node.bodyFields) {
          if (!existing.bodyFields.some((ep) => ep.name === p.name)) existing.bodyFields.push(p);
        }
        if (entry.responseBody && !existing.responseBodyPreview) {
          existing.responseBodyPreview = entry.responseBody.slice(0, 2000);
        }
      }
      continue;
    }

    const id = `cr-${key.replace(/[^a-zA-Z0-9]/g, '_')}`;
    node.id = id;
    seen.add(key);
    idMap.set(key, id);
    nodes.push(node);

    if (entry.parentNodeId && idMap.has(entry.parentNodeId)) {
      edges.push({
        fromId: idMap.get(entry.parentNodeId)!,
        toId: id,
        trigger: entry.triggerType === 'xhr-js' ? 'script' : (entry.triggerType || 'navigation') as GraphEdge['trigger'],
        selector: entry.triggerSelector,
        formData: entry.triggerPayload ? { payload: entry.triggerPayload } : undefined,
        label: `${entry.method} ${entry.url}`,
      });
    }
  }

  return { nodes, edges };
}

export function mergeCrawlFormsIntoGraph(
  snapshots: DOMSnapshot[],
  nodes: GraphNode[],
  edges: GraphEdge[],
): { nodes: GraphNode[]; edges: GraphEdge[] } {
  const result = { nodes: [...nodes], edges: [...edges] };
  for (const snap of snapshots) {
    const parent = nodes.find((n) => n.url === snap.url);
    if (!parent) continue;

    for (const form of snap.forms) {
      const formParams: GraphParam[] = form.fields.map((f) => ({
        name: f.name,
        in: 'body' as const,
        type: f.type,
        value: undefined,
        required: f.required,
      }));

      const node: GraphNode = {
        id: `form-${form.selector.replace(/[^a-zA-Z0-9]/g, '_')}`,
        url: form.action || snap.url,
        method: form.method.toUpperCase(),
        params: [],
        bodyFields: formParams,
        requestHeaders: {},
        responseStatus: 0,
        responseHeaders: {},
        contentType: 'application/x-www-form-urlencoded',
        cookies: {},
        source: 'crawl',
        tags: ['form', 'has-params'],
        observations: [],
        attackResults: [],
        depth: parent.depth + 1,
        title: `form @ ${form.selector}`,
      };

      const key = `${node.method}:${node.url}`;
      if (!result.nodes.some((n) => `${n.method}:${n.url}` === key)) {
        result.nodes.push(node);
        result.edges.push({
          fromId: parent.id,
          toId: node.id,
          trigger: 'form_submit',
          selector: form.selector,
          formData: Object.fromEntries(form.fields.map((f) => [f.name, f.placeholder || ''])),
          label: `form-submit: ${form.selector}`,
        });
      }
    }
  }
  return result;
}
