import type { TraceEntry } from '../core/browser-session';
import type { DOMSnapshot } from '../explorer/dom-observer';

export interface DiscoveredParam {
  name: string;
  type: 'query' | 'body' | 'header' | 'path' | 'cookie';
  confidence: number;
  source: string;
  required?: boolean;
}

export interface DiscoverContext {
  url: string;
  method: string;
  bodyPreview: string;
  contentType: string;
  trace: TraceEntry[];
  responseBody?: string;
  domSnapshot?: DOMSnapshot;
}

export interface ParamDiscoverer {
  id: string;
  name: string;
  cost: 'free' | 'cheap' | 'medium' | 'expensive';
  discover(ctx: DiscoverContext, signal?: AbortSignal): Promise<DiscoveredParam[]>;
}

export interface ParamDiscovererConfig {
  id: string;
  maxCost?: string;
  layers?: Array<{ id: string }>;
}
