import { getGlobalGraphStore } from './store';
import type { ToolSchema } from '../agents/tool-schema';
import type { GraphQueryFilter, GraphNode, GraphObservation } from './types';

export interface GraphToolResult {
  ok: boolean;
  data?: unknown;
  error?: string;
}

const GRAPH_QUERY_SCHEMA: ToolSchema = {
  name: 'queryGraph',
  description:
    'Query the workflow graph with optional filters. Returns a summarized list of matching nodes with their URLs, methods, param names, tags, content types, and response statuses. Use this to explore the attack surface — e.g. find all nodes with params, nodes that return JSON, nodes at specific depth. Results are limited to 50 nodes and truncated if more match.',
  parameters: {
    type: 'object',
    properties: {
      sinkTypes: { type: 'array', items: { type: 'string' }, description: 'Filter by content-type substring. E.g. ["json", "html"]' },
      requiresAuth: { type: 'boolean', description: 'Filter by auth-required tag' },
      nodeTags: { type: 'array', items: { type: 'string' }, description: 'Filter by tags. E.g. ["has-params", "form"]' },
      method: { type: 'string', description: 'Filter by HTTP method. E.g. "GET", "POST"' },
      hasParams: { type: 'boolean', description: 'Only nodes with query/body params' },
      source: { type: 'string', description: 'Filter by source. "crawl", "har", "observation", "attack"' },
      maxDepth: { type: 'number', description: 'Max depth from root' },
      limit: { type: 'number', description: 'Max results (default 50)' },
    },
  },
};

const DRILL_DOWN_SCHEMA: ToolSchema = {
  name: 'drillDown',
  description:
    'Get the full request/response details for a specific graph node by ID. Includes headers, body, response preview, observations, and attack results. Use queryGraph first to find node IDs, then drillDown on the interesting ones.',
  parameters: {
    type: 'object',
    properties: {
      nodeId: { type: 'string', description: 'The graph node ID (e.g. "cr-GET_/api/users")' },
    },
    required: ['nodeId'],
  },
};

const QUERY_FLOW_SCHEMA: ToolSchema = {
  name: 'queryFlow',
  description:
    'Trace a parameter through the graph from a starting node. Shows every node the param flows through, whether it gets reflected in the response, and identifies potential sink nodes. Use this to understand data flow before deciding where to attack.',
  parameters: {
    type: 'object',
    properties: {
      param: { type: 'string', description: 'The parameter name to trace' },
      startNodeId: { type: 'string', description: 'The graph node ID to start tracing from' },
    },
    required: ['param', 'startNodeId'],
  },
};

const OBSERVE_NODE_SCHEMA: ToolSchema = {
  name: 'observeNode',
  description:
    'Send benign probes to a graph node to observe how it responds. Records the response shape, timing, and any reflection of input. This is the "Learn" phase tool — use it to understand param behavior before committing to an attack. Probes are non-destructive (simple strings, numbers, booleans).',
  parameters: {
    type: 'object',
    properties: {
      nodeId: { type: 'string', description: 'The graph node ID to probe' },
      param: { type: 'string', description: 'The param name to inject probes into' },
      probes: {
        type: 'array',
        items: { type: 'string' },
        description: 'Benign probe values. E.g. test, 123, true, single-quote'
      },
    },
    required: ['nodeId', 'param'],
  },
};

export const GRAPH_TOOL_SCHEMAS: Record<string, ToolSchema> = {
  queryGraph: GRAPH_QUERY_SCHEMA,
  drillDown: DRILL_DOWN_SCHEMA,
  queryFlow: QUERY_FLOW_SCHEMA,
  observeNode: OBSERVE_NODE_SCHEMA,
};

export function handleGraphTool(tool: string, args: Record<string, unknown>): GraphToolResult {
  const store = getGlobalGraphStore();

  switch (tool) {
    case 'queryGraph': {
      const filter: GraphQueryFilter = {};
      if (args.sinkTypes) filter.sinkTypes = args.sinkTypes as string[];
      if (args.requiresAuth !== undefined) filter.requiresAuth = args.requiresAuth as boolean;
      if (args.nodeTags) filter.nodeTags = args.nodeTags as string[];
      if (args.method) filter.method = args.method as string;
      if (args.hasParams !== undefined) filter.hasParams = args.hasParams as boolean;
      if (args.source) filter.source = args.source as 'crawl' | 'har' | 'observation' | 'attack';
      if (args.maxDepth !== undefined) filter.maxDepth = args.maxDepth as number;
      if (args.limit !== undefined) filter.limit = args.limit as number;
      const result = store.summarize(filter);
      return { ok: true, data: result };
    }

    case 'drillDown': {
      const nodeId = args.nodeId as string;
      const node = store.getNode(nodeId);
      if (!node) return { ok: false, error: `Node "${nodeId}" not found` };
      const children = store.getChildEdges(nodeId);
      const parents = store.getParentEdges(nodeId);
      return {
        ok: true,
        data: {
          node,
          childrenEdges: children,
          parentEdges: parents,
        },
      };
    }

    case 'queryFlow': {
      const param = args.param as string;
      const startNodeId = args.startNodeId as string;
      if (!store.getNode(startNodeId)) return { ok: false, error: `Start node "${startNodeId}" not found` };
      const flow = store.traceFlow(param, startNodeId);
      return { ok: true, data: flow };
    }

    case 'observeNode': {
      const nodeId = args.nodeId as string;
      const param = args.param as string;
      const probes = (args.probes as string[]) || ['test', '123', 'true', "'"];
      const node = store.getNode(nodeId);
      if (!node) return { ok: false, error: `Node "${nodeId}" not found` };
      const observations: GraphObservation[] = probes.map((probe) => ({
        probe,
        location: param,
        responseDelta: 'pending',
        responseStatus: 0,
        responseBodySnippet: '',
        timestamp: Date.now(),
      }));
      for (const obs of observations) {
        store.addObservation(nodeId, obs);
      }
      return {
        ok: true,
        data: {
          nodeId,
          param,
          observations,
          hint: 'Observations recorded. Use drillDown to re-read node with full observations.',
        },
      };
    }

    default:
      return { ok: false, error: `Unknown graph tool: ${tool}` };
  }
}
