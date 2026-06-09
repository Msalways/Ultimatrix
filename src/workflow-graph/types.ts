export type GraphNodeSource = 'har' | 'crawl' | 'observation' | 'attack';
export type GraphEdgeTrigger = 'click' | 'form_submit' | 'navigation' | 'redirect' | 'script' | 'hash-change' | 'attack-result';

export interface GraphParam {
  name: string;
  in: 'query' | 'body' | 'path' | 'header' | 'cookie';
  type: string;
  value?: string;
  required: boolean;
}

export interface GraphObservation {
  probe: string;
  location: string;
  responseDelta: string;
  inferredSurface?: string;
  responseStatus: number;
  responseBodySnippet: string;
  timestamp: number;
}

export interface AttackResult {
  technique: string;
  findingId: string;
  confidence: number;
  payload: string;
  evidence: string[];
  timestamp: number;
}

export interface GraphNode {
  id: string;
  url: string;
  method: string;
  params: GraphParam[];
  bodyFields: GraphParam[];
  requestHeaders: Record<string, string>;
  requestBody?: string;
  responseStatus: number;
  responseHeaders: Record<string, string>;
  responseBodyPreview?: string;
  contentType: string;
  cookies: Record<string, string>;
  source: GraphNodeSource;
  tags: string[];
  observations: GraphObservation[];
  attackResults: AttackResult[];
  depth: number;
  title: string;
}

export interface GraphEdge {
  fromId: string;
  toId: string;
  trigger: GraphEdgeTrigger;
  selector?: string;
  formData?: Record<string, string>;
  label: string;
  dataFlow?: Array<{ param: string; fromNode: string; toNode: string }>;
}

export interface GraphSnapshot {
  nodes: GraphNode[];
  edges: GraphEdge[];
  metadata: {
    target: string;
    createdAt: number;
    nodeCount: number;
    edgeCount: number;
  };
}

export type GraphQueryFilter = {
  sinkTypes?: string[];
  requiresAuth?: boolean;
  nodeTags?: string[];
  method?: string;
  hasParams?: boolean;
  source?: GraphNodeSource;
  maxDepth?: number;
  limit?: number;
};

export interface GraphQueryResult {
  nodes: Array<{
    id: string;
    url: string;
    method: string;
    paramNames: string[];
    tags: string[];
    contentType: string;
    responseStatus: number;
    source: GraphNodeSource;
    depth: number;
  }>;
  edges: Array<{
    fromId: string;
    toId: string;
    trigger: GraphEdgeTrigger;
    label: string;
  }>;
  totalNodes: number;
  totalEdges: number;
  truncated: boolean;
}

export interface FlowTrace {
  param: string;
  path: Array<{
    nodeId: string;
    url: string;
    location: string;
    reflected: boolean;
    encoded: boolean;
  }>;
  sinks: string[];
}
