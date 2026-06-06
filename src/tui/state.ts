// src/tui/state.ts
//
// In-memory state of the 4-pane TUI. The reducer is pure: every
// HuntEvent translates to one or more StateActions. The TUI renders
// the current state. No direct dependency on HuntCore — only on
// HuntEvent.

import type { HuntEvent, LLMToken } from '../hunt/events';
import type { AppModelFinding } from '../core/app-model';
import type { BehavioralStep } from '../hunt/recorder/step-types';

export interface ActivityLine {
  id: string;
  text: string;
  level: 'info' | 'warn' | 'error' | 'success' | 'agent';
  timestamp: number;
}

export interface FindingView {
  id: string;
  type: string;
  severity: string;
  endpoint: string;
  param?: string;
  confidence: string;
  description?: string;
  observedAt: number;
}

export interface ChatLine {
  role: 'user' | 'assistant' | 'system';
  text: string;
  timestamp: number;
}

export interface TuiState {
  status: {
    phase: string;
    elapsedSeconds: number;
    cost: number;
    findingsCount: number;
    stepsCount: number;
    primitiveCalls: number;
    oobCallbacks: number;
    etaSeconds: number;
  };
  activity: ActivityLine[];
  findings: FindingView[];
  chat: ChatLine[];
  streamingText: { source: string; text: string; done: boolean } | null;
  paused: boolean;
  width: number;
  height: number;
}

export function makeInitialState(): TuiState {
  return {
    status: {
      phase: 'starting',
      elapsedSeconds: 0,
      cost: 0,
      findingsCount: 0,
      stepsCount: 0,
      primitiveCalls: 0,
      oobCallbacks: 0,
      etaSeconds: 0,
    },
    activity: [],
    findings: [],
    chat: [],
    streamingText: null,
    paused: false,
    width: 120,
    height: 40,
  };
}

export type StateAction =
  | { type: 'phase'; phase: string }
  | { type: 'budget'; elapsedSeconds: number; cost: number; etaSeconds: number }
  | { type: 'count'; stepsCount: number; primitiveCalls: number; oobCallbacks: number }
  | { type: 'activity'; line: ActivityLine }
  | { type: 'finding'; finding: FindingView }
  | { type: 'chat'; line: ChatLine }
  | { type: 'llm-token-start'; source: string }
  | { type: 'llm-token'; source: string; text: string; done: boolean }
  | { type: 'resize'; width: number; height: number }
  | { type: 'toggle-paused' };

const MAX_ACTIVITY = 500;
const MAX_CHAT = 200;

export function reduce(state: TuiState, action: StateAction): TuiState {
  switch (action.type) {
    case 'phase':
      return { ...state, status: { ...state.status, phase: action.phase } };
    case 'budget':
      return { ...state, status: { ...state.status, elapsedSeconds: action.elapsedSeconds, cost: action.cost, etaSeconds: action.etaSeconds } };
    case 'count':
      return { ...state, status: { ...state.status, stepsCount: action.stepsCount, primitiveCalls: action.primitiveCalls, oobCallbacks: action.oobCallbacks } };
    case 'activity': {
      const next = [...state.activity, action.line];
      if (next.length > MAX_ACTIVITY) next.splice(0, next.length - MAX_ACTIVITY);
      return { ...state, activity: next };
    }
    case 'finding': {
      const exists = state.findings.find((f) => f.id === action.finding.id);
      if (exists) return state;
      return { ...state, findings: [action.finding, ...state.findings], status: { ...state.status, findingsCount: state.findings.length + 1 } };
    }
    case 'chat': {
      const next = [...state.chat, action.line];
      if (next.length > MAX_CHAT) next.splice(0, next.length - MAX_CHAT);
      return { ...state, chat: next };
    }
    case 'llm-token-start':
      return { ...state, streamingText: { source: action.source, text: '', done: false } };
    case 'llm-token':
      if (!state.streamingText || state.streamingText.source !== action.source) return state;
      return { ...state, streamingText: { source: action.source, text: state.streamingText.text + action.text, done: action.done } };
    case 'resize':
      return { ...state, width: action.width, height: action.height };
    case 'toggle-paused':
      return { ...state, paused: !state.paused };
    default:
      return state;
  }
}

/** Convert a HuntEvent into 0+ StateActions. */
export function eventToActions(event: HuntEvent): StateAction[] {
  switch (event.type) {
    case 'phase':
      return [{ type: 'phase', phase: event.phase }];
    case 'budget-update': {
      const elapsed = event.budget.limit - event.budget.remainingSeconds > 0 ? Math.max(0, event.budget.etaSeconds) : 0;
      return [{
        type: 'budget',
        elapsedSeconds: elapsed,
        cost: event.budget.spent,
        etaSeconds: event.budget.etaSeconds,
      }];
    }
    case 'behavioral-step':
      return [];
    case 'primitive-call':
      return [{
        type: 'activity',
        line: {
          id: event.call.id,
          text: `▶ ${event.call.primitive} (${shorten(event.call.args)})`,
          level: 'info',
          timestamp: Date.now(),
        },
      }];
    case 'llm-token': {
      const out: StateAction[] = [];
      if (event.token.text.length > 0) {
        out.push({ type: 'llm-token', source: event.token.source, text: event.token.text, done: event.token.done });
      }
      if (event.token.done) {
        out.push({ type: 'llm-token', source: event.token.source, text: '', done: true });
      }
      return out;
    }
    case 'finding': {
      const f = event.finding;
      return [{
        type: 'finding',
        finding: {
          id: f.id ?? `${f.type}-${f.endpoint}-${f.param ?? ''}`,
          type: f.type,
          severity: f.severity,
          endpoint: f.endpoint,
          param: f.param,
          confidence: String(f.confidence),
          description: f.description,
          observedAt: Date.now(),
        },
      }];
    }
    case 'finding-deduped':
      return [{
        type: 'activity',
        line: { id: `dup-${event.finding.id ?? ''}`, text: `~ dedup: ${event.finding.type} on ${event.finding.endpoint}`, level: 'info', timestamp: Date.now() },
      }];
    case 'screenshot':
      return [{
        type: 'activity',
        line: { id: `shot-${event.screenshot.path}`, text: `📸 ${event.screenshot.label} (${event.screenshot.width}x${event.screenshot.height})`, level: 'info', timestamp: Date.now() },
      }];
    case 'oob-callback':
      return [{
        type: 'activity',
        line: { id: `oob-${event.callback.url}`, text: `⚡ OOB ${event.callback.source}: ${event.callback.url}`, level: 'warn', timestamp: Date.now() },
      }];
    case 'chat-message':
      return [{
        type: 'chat',
        line: { role: event.message.role, text: event.message.text, timestamp: Date.now() },
      }];
    case 'log':
      return [{
        type: 'activity',
        line: { id: `log-${Date.now()}-${Math.random()}`, text: event.log.text, level: event.log.level === 'error' ? 'error' : event.log.level === 'warn' ? 'warn' : 'info', timestamp: Date.now() },
      }];
    case 'agent-spawn':
      return [{
        type: 'activity',
        line: { id: `spawn-${event.agentId}`, text: `⤳ spawn ${event.role} (${event.agentId.slice(0, 8)})`, level: 'agent', timestamp: Date.now() },
      }];
    case 'agent-action':
      return [{
        type: 'activity',
        line: {
          id: `act-${event.agentId}-${Date.now()}-${Math.random()}`,
          text: `${event.tool} ${shorten(event.args)}`,
          level: 'agent',
          timestamp: Date.now(),
        },
      }];
    case 'diff':
      return [{
        type: 'activity',
        line: { id: `diff-${Date.now()}`, text: `Δ diff vs last hunt: +${event.added.length}/−${event.removed.length}/r${event.regressed.length}`, level: 'info', timestamp: Date.now() },
      }];
    case 'done':
      return [{
        type: 'activity',
        line: { id: `done-${Date.now()}`, text: `■ done (${event.reason}): ${event.summary.findingsCount} findings`, level: 'success', timestamp: Date.now() },
      }];
  }
}

function shorten(args: unknown): string {
  try {
    const s = JSON.stringify(args);
    if (!s) return '';
    return s.length > 80 ? s.slice(0, 77) + '...' : s;
  } catch {
    return '';
  }
}

export function formatStatusLine(status: TuiState['status']): string {
  const mins = Math.floor(status.elapsedSeconds / 60);
  const secs = Math.floor(status.elapsedSeconds % 60);
  return `phase: ${status.phase} | ${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')} | $${status.cost.toFixed(2)} | ${status.findingsCount}F/${status.stepsCount}S/${status.primitiveCalls}P/${status.oobCallbacks}OOB | eta ${status.etaSeconds}s`;
}

/** Convert a finding to a one-line summary. */
export function formatFindingLine(f: FindingView): string {
  return `[${f.severity.toUpperCase()}] ${f.type}  ${f.endpoint}${f.param ? '?' + f.param : ''}  (${f.confidence})`;
}

/** Convert a behavioral step to a one-line activity log. */
export function formatStepLine(step: BehavioralStep): string {
  switch (step.type) {
    case 'navigate': {
      const d = step.data as { url: string; method: string };
      return `→ ${d.method}: ${d.url}`;
    }
    case 'click': {
      const d = step.data as { selector: string; text?: string };
      return `  click ${d.selector}${d.text ? ' (' + d.text + ')' : ''}`;
    }
    case 'fill': {
      const d = step.data as { selector: string; isPassword: boolean };
      return `  fill  ${d.selector}${d.isPassword ? ' (password)' : ''}`;
    }
    case 'request': {
      const d = step.data as { method: string; url: string };
      return `  ${d.method} ${d.url}`;
    }
    case 'response': {
      const d = step.data as { status: number; url: string };
      return `  ← ${d.status} ${d.url}`;
    }
    case 'error': {
      const d = step.data as { kind: string; message: string };
      return `  ✗ ${d.kind}: ${d.message}`;
    }
    default:
      return `  ${step.type}`;
  }
}
