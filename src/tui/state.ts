// src/tui/state.ts
//
// In-memory state of the 4-pane TUI. The reducer is pure: every
// HuntEvent translates to one or more StateActions. The TUI renders
// the current state. No direct dependency on HuntCore — only on
// HuntEvent.

import type { HuntEvent, LLMToken } from '../hunt/events';
import type { AppModelFinding } from '../core/app-model';
import type { BehavioralStep } from '../hunt/recorder/step-types';

export interface RenderedScreenshot {
  ansi: string;
  width: number;
  height: number;
  placeholder: boolean;
}

export interface ActivityLine {
  id: string;
  text: string;
  level: 'info' | 'warn' | 'error' | 'success' | 'agent';
  timestamp: number;
  /** Inline ANSI render of an attached screenshot (post-attach). */
  screenshot?: RenderedScreenshot;
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
  /** Lines scrolled back from the bottom of activity (0 = most recent). */
  activityScroll: number;
  /** Lines scrolled back from the top of findings (0 = most recent). */
  findingsScroll: number;
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
    activityScroll: 0,
    findingsScroll: 0,
  };
}

export type StateAction =
  | { type: 'phase'; phase: string }
  | { type: 'budget'; elapsedSeconds: number; cost: number; etaSeconds: number }
  | { type: 'count'; stepsCount: number; primitiveCalls: number; oobCallbacks: number }
  | { type: 'activity'; line: ActivityLine }
  | { type: 'activity-attach'; id: string; screenshot: RenderedScreenshot }
  | { type: 'finding'; finding: FindingView }
  | { type: 'chat'; line: ChatLine }
  | { type: 'llm-token-start'; source: string }
  | { type: 'llm-token'; source: string; text: string; done: boolean }
  | { type: 'resize'; width: number; height: number }
  | { type: 'toggle-paused' }
  | { type: 'scroll-activity'; delta: number }
  | { type: 'scroll-findings'; delta: number };

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
      return { ...state, activity: next, activityScroll: 0 };
    }
    case 'activity-attach': {
      const idx = state.activity.findIndex((l) => l.id === action.id);
      if (idx === -1) return state;
      const updated: ActivityLine = { ...state.activity[idx], screenshot: action.screenshot };
      const next = [...state.activity];
      next[idx] = updated;
      return { ...state, activity: next };
    }
    case 'finding': {
      const exists = state.findings.find((f) => f.id === action.finding.id);
      if (exists) return state;
      return { ...state, findings: [action.finding, ...state.findings], findingsScroll: 0, status: { ...state.status, findingsCount: state.findings.length + 1 } };
    }
    case 'chat': {
      const next = [...state.chat, action.line];
      if (next.length > MAX_CHAT) next.splice(0, next.length - MAX_CHAT);
      return { ...state, chat: next };
    }
    case 'llm-token-start':
      return { ...state, streamingText: { source: action.source, text: '', done: false } };
    case 'llm-token': {
      const existing = state.streamingText;
      // If there's no current stream, or the source switched, start a
      // new one. This makes replay (where the start event was lost)
      // work correctly: the first token creates the stream, the rest
      // append to it.
      if (!existing || existing.source !== action.source) {
        return { ...state, streamingText: { source: action.source, text: action.text, done: action.done } };
      }
      return { ...state, streamingText: { source: action.source, text: existing.text + action.text, done: action.done } };
    }
    case 'resize':
      return { ...state, width: Math.max(40, action.width), height: Math.max(10, action.height) };
    case 'toggle-paused':
      return { ...state, paused: !state.paused };
    case 'scroll-activity': {
      // Activity is a windowed view of a possibly longer array. We track
      // how many lines back from the BOTTOM we are scrolled.
      const maxScroll = Math.max(0, state.activity.length - 1);
      const next = Math.max(0, Math.min(maxScroll, state.activityScroll + action.delta));
      return { ...state, activityScroll: next };
    }
    case 'scroll-findings': {
      const maxScroll = Math.max(0, state.findings.length - 1);
      const next = Math.max(0, Math.min(maxScroll, state.findingsScroll + action.delta));
      return { ...state, findingsScroll: next };
    }
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
          text: `${event.call.primitive} (${shorten(event.call.args)})`,
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
        line: { id: `dup-${event.finding.id ?? ''}`, text: `dedup: ${event.finding.type} on ${event.finding.endpoint}`, level: 'info', timestamp: Date.now() },
      }];
    case 'screenshot': {
      // Show just the filename in the activity row — full paths are
      // noisy and the user can open the file with the path stored
      // alongside (or via /open).
      const sep = event.screenshot.path.lastIndexOf('/') >= 0 ? '/' : '\\';
      const idx = event.screenshot.path.lastIndexOf(sep);
      const filename = idx >= 0 ? event.screenshot.path.slice(idx + 1) : event.screenshot.path;
      return [{
        type: 'activity',
        line: {
          id: `shot-${event.screenshot.path}`,
          text: `screenshot ${event.screenshot.label} (${event.screenshot.width}x${event.screenshot.height}) saved: ${filename}`,
          level: 'info',
          timestamp: Date.now(),
        },
      }];
    }
    case 'oob-callback':
      return [{
        type: 'activity',
        line: { id: `oob-${event.callback.url}`, text: `OOB ${event.callback.source}: ${event.callback.url}`, level: 'warn', timestamp: Date.now() },
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
        line: { id: `spawn-${event.agentId}`, text: `spawn ${event.role} (${event.agentId.slice(0, 8)})`, level: 'agent', timestamp: Date.now() },
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
        line: { id: `diff-${Date.now()}`, text: `diff vs last hunt: +${event.added.length}/−${event.removed.length}/r${event.regressed.length}`, level: 'info', timestamp: Date.now() },
      }];
    case 'done':
      return [{
        type: 'activity',
        line: { id: `done-${Date.now()}`, text: `done (${event.reason}): ${event.summary.findingsCount} findings`, level: 'success', timestamp: Date.now() },
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

/** HH:MM:SS local-time formatter for activity timestamps. */
export function formatClock(ts: number): string {
  const d = new Date(ts);
  const h = String(d.getHours()).padStart(2, '0');
  const m = String(d.getMinutes()).padStart(2, '0');
  const s = String(d.getSeconds()).padStart(2, '0');
  return `${h}:${m}:${s}`;
}

/** Compact level badge for activity rows. */
export function formatLevelBadge(level: ActivityLine['level']): string {
  switch (level) {
    case 'error': return 'ERR';
    case 'warn': return 'WRN';
    case 'success': return ' OK';
    case 'agent': return 'AGT';
    default: return '   ';
  }
}

/** Map a phase string to a colour (lowercase ink colour name). */
export function phaseColor(phase: string): 'gray' | 'cyan' | 'yellow' | 'red' | 'magenta' | 'green' {
  if (phase === 'done' || phase === 'complete') return 'green';
  if (phase === 'reporting' || phase === 'finalising') return 'cyan';
  if (phase === 'attacking' || phase === 'recon') return 'yellow';
  if (phase === 'spidering' || phase === 'crawling') return 'cyan';
  if (phase === 'error' || phase === 'failed') return 'red';
  return 'gray';
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
