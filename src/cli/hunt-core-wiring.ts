// src/cli/hunt-core-wiring.ts
//
// Bridge between the v3 hunt pipeline (Composer + AutonomousV3Orchestrator
// + InteractiveHuntSession) and the v4 HuntCore event stream. The v3 code
// exposes its findings, primitive calls, OOB callbacks, etc. through
// per-callback hooks; HuntCore wants every event to flow through
// `recordXxx()` methods. This module wires them together so:
//
//   - every v3 finding hits `core.recordFinding()` (dedup by type+endpoint+param)
//   - every v3 primitive call hits `core.recordPrimitiveCall()`
//   - chat messages, OOB callbacks, screenshots, logs also flow in
//   - the core's `done` event is forwarded to an external `onHuntEnd` hook
//
// The wiring is intentionally a *pure transformer* of v3-shaped callbacks
// into v4-shaped `record*` calls. It does not start/stop the core; that
// is the caller's responsibility (`runHunt` calls `core.start()` early
// and `core.stop('user-quit')` after the race completes).
//
// This module is the smallest possible migration step in Block 14:
// we keep the v3 pipeline as the work-doer and graft HuntCore on top
// as the single source of truth. The bigger refactor — driving the
// orchestrator from the core's `tick()` — is Block 17+.

import type { HuntCore } from '../hunt/core';
import type { AppModelFinding } from '../core/app-model';
import type { PrimitiveCall, ChatMessageEvent, LogEvent, OOBCallbackEvent, ScreenshotEvent } from '../hunt/events';
import type { TerminationReason } from '../hunt/types';
import { randomUUID } from 'node:crypto';

export interface WireHuntCoreOptions {
  /** The HuntCore to record events into. */
  core: HuntCore;
  /**
   * Called when the core emits a `done` event. The hunt caller
   * (e.g. `runHunt`) uses this to know when to await the final summary
   * and write it to disk.
   */
  onHuntEnd?: (reason: TerminationReason) => void;
  /**
   * Optional sink for `finding-deduped` events. The CLI uses this to
   * print a dim `↳ deduped` line so the user sees that the core caught
   * a repeat without it flooding the live findings count.
   */
  onFindingDeduped?: (finding: AppModelFinding, existingId: string) => void;
  /**
   * Agent ID stamped onto every PrimitiveCall so sub-agent dispatches
   * are distinguishable in the event stream. Default: 'main'.
   */
  agentId?: string;
}

export interface HuntCoreWiring {
  /**
   * Called by the v3 orchestrator's `onFinding` and by the interactive
   * session's finding flow. Returns `true` if the finding was added
   * (and the caller should also persist it to `app-model.json`); `false`
   * if the core already has the same (type, endpoint, param).
   */
  onFinding: (finding: AppModelFinding) => boolean;
  /**
   * Called by the v3 orchestrator's `onPrimitive` callback and by any
   * primitive the Composer invokes. Stamps a UUID + startedAt.
   */
  onPrimitive: (
    name: string,
    args: unknown,
    result: { ok: boolean; error?: string; durationMs: number }
  ) => void;
  /** Forward a chat round-trip into the core. */
  onChat: (role: 'user' | 'assistant' | 'system', text: string) => void;
  /** Forward a free-form log line into the core. */
  onLog: (level: 'info' | 'warn' | 'error' | 'debug', text: string) => void;
  /** Forward an OOB callback. */
  onOOB: (callback: OOBCallbackEvent) => void;
  /** Forward a screenshot. */
  onScreenshot: (screenshot: ScreenshotEvent) => void;
  /** Detach the subscription; safe to call multiple times. */
  unsubscribe: () => void;
}

export function wireHuntCore(opts: WireHuntCoreOptions): HuntCoreWiring {
  const { core, onHuntEnd, onFindingDeduped, agentId = 'main' } = opts;
  let unsubscribed = false;

  const unsubscribe = core.on((event) => {
    if (unsubscribed) return;
    if (event.type === 'done') {
      onHuntEnd?.(event.reason);
    } else if (event.type === 'finding-deduped') {
      onFindingDeduped?.(event.finding, event.existingId);
    }
  });

  return {
    onFinding(finding) {
      return core.recordFinding(finding);
    },
    onPrimitive(name, args, result) {
      const now = Date.now();
      const call: PrimitiveCall = {
        id: randomUUID(),
        agentId,
        primitive: name,
        args,
        startedAt: now - result.durationMs,
        endedAt: now,
        result: { ok: result.ok },
        error: result.ok ? undefined : result.error,
      };
      core.recordPrimitiveCall(call);
    },
    onChat(role, text) {
      const message: ChatMessageEvent = { role, text };
      core.recordChatMessage(message);
    },
    onLog(level, text) {
      const log: LogEvent = { level, text };
      core.recordLog(log);
    },
    onOOB(callback) {
      core.recordOOB(callback);
    },
    onScreenshot(screenshot) {
      core.recordScreenshot(screenshot);
    },
    unsubscribe() {
      if (unsubscribed) return;
      unsubscribed = true;
      unsubscribe();
    },
  };
}
