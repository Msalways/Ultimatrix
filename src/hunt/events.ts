// src/hunt/events.ts
//
// HuntEvent is the public event stream the HuntCore emits.
// All four frontends (TUI, headless CI, chat REPL, report HTML)
// subscribe to this single stream and render what they need.

import type { BehavioralStep } from './recorder/step-types';
import type { HuntSummary, TerminationReason } from './types';
import type { AppModelFinding } from '../core/app-model';

/** Live status of a primitive invocation. */
export interface PrimitiveCall {
  id: string;
  agentId: string;
  primitive: string;
  args: unknown;
  startedAt: number;
  endedAt?: number;
  result?: unknown;
  error?: string;
}

/** Live LLM token streaming. */
export interface LLMToken {
  source: LLMCallSite;
  text: string;
  done: boolean;
  model?: string;
  durationMs?: number;
}

export type LLMCallSite = 'composer' | 'triage' | 'chat' | 'specialist' | 'browser-driver' | 'codegen-mutator';

/** Live screenshot event. */
export interface ScreenshotEvent {
  path: string;
  label: string;
  width: number;
  height: number;
  sizeBytes: number;
  /** Set when the screenshot is attached to a finding. */
  findingId?: string;
}

/** OOB callback received from the OAST server. */
export interface OOBCallbackEvent {
  url: string;
  source: 'ssrf' | 'blind-xss' | 'blind-sqli' | 'xxe' | 'deserialization';
  bodyPreview: string;
  headers: Record<string, string>;
  receivedAt: number;
}

/** Chat message round-trip. */
export interface ChatMessageEvent {
  role: 'user' | 'assistant' | 'system';
  text: string;
  actions?: import('../cli/chat-coordinator').ChatAction[];
  observations?: import('../cli/chat-coordinator').ChatObservation[];
}

/** Budget update. */
export interface BudgetUpdate {
  spent: number;
  limit: number;
  remainingSeconds: number;
  etaSeconds: number;
}

/** Free-form log. */
export interface LogEvent {
  level: 'info' | 'warn' | 'error' | 'debug';
  text: string;
  source?: string;
}

export type HuntEvent =
  | { type: 'phase'; phase: 'starting' | 'observing' | 'attacking' | 'analyzing' | 'done' }
  | { type: 'agent-spawn'; agentId: string; parentAgentId?: string; role: string }
  | { type: 'agent-action'; agentId: string; tool: string; args: unknown; result?: unknown; error?: string }
  | { type: 'primitive-call'; call: PrimitiveCall }
  | { type: 'behavioral-step'; step: BehavioralStep }
  | { type: 'llm-token'; token: LLMToken }
  | { type: 'finding'; finding: AppModelFinding }
  | { type: 'finding-deduped'; finding: AppModelFinding; existingId: string }
  | { type: 'screenshot'; screenshot: ScreenshotEvent }
  | { type: 'oob-callback'; callback: OOBCallbackEvent }
  | { type: 'chat-message'; message: ChatMessageEvent }
  | { type: 'budget-update'; budget: BudgetUpdate }
  | { type: 'log'; log: LogEvent }
  | { type: 'diff'; previousHuntAt: string; added: AppModelFinding[]; removed: string[]; regressed: AppModelFinding[] }
  | { type: 'done'; reason: TerminationReason; summary: HuntSummary };
