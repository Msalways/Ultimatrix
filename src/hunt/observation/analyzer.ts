// src/hunt/observation/analyzer.ts
//
// BehavioralAnalyzer ingests BehavioralSteps and builds a behavioral
// AppModel on top of the static AppModel the spider built. The LLM
// attack planner reads both: static for routes/endpoints, behavioral
// for the actual observed user flow + APIs touched + error patterns.

import type { BehavioralStep } from '../recorder/step-types';

export interface ObservedFlow {
  name: string;
  steps: string[]; // step IDs
  description: string;
  observedAt: number;
}

export interface ObservedAPI {
  method: string;
  url: string;
  callCount: number;
  avgStatus: number;
  lastBodyPreview: string;
  lastContentType: string;
  firstSeenAt: number;
  lastSeenAt: number;
}

export interface ObservedError {
  message: string;
  kind: 'js' | 'network' | 'csp' | 'cors' | 'mixed-content' | 'webgl';
  url?: string;
  count: number;
  firstSeenAt: number;
  lastSeenAt: number;
}

export interface ObservedStorageKey {
  kind: 'localStorage' | 'sessionStorage' | 'cookie';
  key: string;
  lastValue?: string;
  setCount: number;
  lastSetAt: number;
}

export interface BehavioralModel {
  flows: ObservedFlow[];
  apis: Map<string, ObservedAPI>; // key: method + url
  errors: Map<string, ObservedError>; // key: kind + message
  storageKeys: Map<string, ObservedStorageKey>;
  pagesVisited: Set<string>;
  redirects: Array<{ from: string; to: string; trigger: string }>;
  consoleErrors: string[];
  mutationCount: number;
  lastUpdated: number;
}

export class BehavioralAnalyzer {
  private model: BehavioralModel = {
    flows: [],
    apis: new Map(),
    errors: new Map(),
    storageKeys: new Map(),
    pagesVisited: new Set(),
    redirects: [],
    consoleErrors: [],
    mutationCount: 0,
    lastUpdated: Date.now(),
  };
  private currentFlow: string[] = [];
  private currentFlowName: string = 'default';
  private currentFlowStartedAt: number = Date.now();

  ingest(step: BehavioralStep): void {
    this.model.lastUpdated = Date.now();
    this.model.pagesVisited.add(step.url);

    if (step.type === 'navigate') {
      const d = step.data as { url: string; method: 'spa' | 'hard' };
      // Finalise the flow leading UP TO the navigate (without including the navigate itself).
      this.finaliseCurrentFlow(`navigate to ${d.url}`);
      this.currentFlowName = d.url;
      this.currentFlow = [];
      this.currentFlowStartedAt = step.timestamp;
      return;
    }

    // All non-navigate steps join the current flow.
    this.currentFlow.push(step.id);

    switch (step.type) {
      case 'request': {
        const d = step.data as { method: string; url: string };
        const key = `${d.method} ${d.url}`;
        const existing = this.model.apis.get(key);
        if (existing) {
          existing.callCount += 1;
          existing.lastSeenAt = step.timestamp;
        } else {
          this.model.apis.set(key, {
            method: d.method,
            url: d.url,
            callCount: 1,
            avgStatus: 0,
            lastBodyPreview: '',
            lastContentType: '',
            firstSeenAt: step.timestamp,
            lastSeenAt: step.timestamp,
          });
        }
        break;
      }
      case 'response': {
        const d = step.data as { method?: string; url: string; status: number; bodyPreview: string; contentType: string };
        // Find a matching API by URL (best effort).
        for (const api of this.model.apis.values()) {
          if (api.url === d.url) {
            api.avgStatus = api.callCount > 0 ? (api.avgStatus * (api.callCount - 1) + d.status) / api.callCount : d.status;
            api.lastBodyPreview = d.bodyPreview;
            api.lastContentType = d.contentType;
            break;
          }
        }
        break;
      }
      case 'redirect': {
        const d = step.data as { from: string; to: string; trigger: string };
        this.model.redirects.push({ from: d.from, to: d.to, trigger: d.trigger });
        break;
      }
      case 'console': {
        const d = step.data as { level: string; text: string };
        if (d.level === 'error') this.model.consoleErrors.push(d.text);
        break;
      }
      case 'error': {
        const d = step.data as { message: string; kind: ObservedError['kind']; url?: string };
        const key = `${d.kind}::${d.message.slice(0, 200)}`;
        const existing = this.model.errors.get(key);
        if (existing) {
          existing.count += 1;
          existing.lastSeenAt = step.timestamp;
        } else {
          this.model.errors.set(key, {
            message: d.message,
            kind: d.kind,
            url: d.url,
            count: 1,
            firstSeenAt: step.timestamp,
            lastSeenAt: step.timestamp,
          });
        }
        break;
      }
      case 'storage': {
        const d = step.data as { kind: ObservedStorageKey['kind']; key?: string; value?: string };
        if (!d.key) break;
        const k = `${d.kind}::${d.key}`;
        const existing = this.model.storageKeys.get(k);
        if (existing) {
          existing.setCount += 1;
          existing.lastValue = d.value;
          existing.lastSetAt = step.timestamp;
        } else {
          this.model.storageKeys.set(k, {
            kind: d.kind,
            key: d.key,
            lastValue: d.value,
            setCount: 1,
            lastSetAt: step.timestamp,
          });
        }
        break;
      }
      case 'mutation': {
        this.model.mutationCount += 1;
        break;
      }
      default:
        break;
    }
  }

  finaliseCurrentFlow(description: string): void {
    if (this.currentFlow.length === 0) return;
    this.model.flows.push({
      name: this.currentFlowName,
      steps: [...this.currentFlow],
      description,
      observedAt: this.currentFlowStartedAt,
    });
    this.currentFlow = [];
  }

  getModel(): BehavioralModel {
    return this.model;
  }

  reset(): void {
    this.model = {
      flows: [],
      apis: new Map(),
      errors: new Map(),
      storageKeys: new Map(),
      pagesVisited: new Set(),
      redirects: [],
      consoleErrors: [],
      mutationCount: 0,
      lastUpdated: Date.now(),
    };
    this.currentFlow = [];
    this.currentFlowName = 'default';
    this.currentFlowStartedAt = Date.now();
  }
}

/** Serialise the behavioral model to a plain object (Maps become arrays). */
export function serialiseBehavioralModel(model: BehavioralModel): Record<string, unknown> {
  return {
    flows: model.flows,
    apis: Array.from(model.apis.values()),
    errors: Array.from(model.errors.values()),
    storageKeys: Array.from(model.storageKeys.values()),
    pagesVisited: Array.from(model.pagesVisited),
    redirects: model.redirects,
    consoleErrors: model.consoleErrors,
    mutationCount: model.mutationCount,
    lastUpdated: model.lastUpdated,
  };
}
