// src/tui/app.tsx
//
// Ink entry point. Subscribes to a HuntCore's event stream, dispatches
// events to a reducer, and renders the 4-pane view. Handles SIGINT
// gracefully. Uses stdin for chat input (so the user can steer).
//
// Block 20 polish:
//   - Real terminal size detection (resizes as the user resizes their
//     terminal; old code was hardcoded 120x40).
//   - Async inline screenshot rendering: screenshot events get an
//     extra multi-line ANSI render attached below the activity row.
//   - PgUp/PgDn to scroll the activity and findings panes back in
//     history. State tracks how many lines back from the bottom each
//     pane is scrolled.
//   - Tab toggles pause (kept); pause indicator shown in the status
//     bar via a "⏸" prefix instead of a separate line.
//   - Footer with dim key hints so the user can discover keys without
//     reading docs.

import React, { useEffect, useState, useReducer, useRef } from 'react';
import { render, Box, Text, useInput, useStdout, useApp as useInkApp } from 'ink';
import { TuiView } from './view';
import { makeInitialState, reduce, eventToActions, type ActivityLine, type FindingView } from './state';
import type { TuiState } from './state';
import type { HuntEvent } from '../hunt/events';
import type { HuntCore } from '../hunt/core';
import { renderScreenshotToAnsi } from './screenshot';

export interface TuiAppProps {
  core: HuntCore;
  onQuit?: () => void;
  onChatMessage?: (text: string) => void;
  /** Snapshot of current state for external inspection. */
  onState?: (state: TuiState) => void;
}

export function TuiApp({ core, onQuit, onChatMessage, onState }: TuiAppProps): React.ReactElement {
  // Seed initial state from the core (in case the TUI was attached
  // AFTER events had already fired — test code, web dashboard, etc.).
  const [state, dispatch] = useReducer(reduce, undefined, () => seedFromCore(core));
  // Chat draft is a ref + version counter so individual keypresses
  // are appendable synchronously (React's batched useState would
  // make stdin.write('hello') + '\r' race with the assertion in
  // tests). The counter forces a re-render to display the prompt.
  const chatDraftRef = useRef('');
  const [chatDraftVersion, setChatDraftVersion] = useState(0);
  const chatDraft = chatDraftRef.current;
  const { stdout } = useStdout();
  const { exit } = useInkApp();

  // Real terminal size. Dispatch a resize action whenever the terminal
  // changes size (user drags the window).
  useEffect(() => {
    const update = () => {
      dispatch({ type: 'resize', width: stdout.columns || 120, height: stdout.rows || 40 });
    };
    update();
    stdout.on('resize', update);
    return () => {
      stdout.off('resize', update);
    };
  }, [stdout]);

  useEffect(() => {
    if (onState) onState(state);
  }, [state, onState]);

  // Subscribe to HuntCore events. Side effect: kick off async screenshot
  // rendering for any 'screenshot' event so the activity row gets an
  // inline ANSI image attached a moment later.
  useEffect(() => {
    const unsub = core.on((event: HuntEvent) => {
      if (state.paused) return;
      const actions = eventToActions(event);
      for (const a of actions) dispatch(a);
      if (event.type === 'screenshot') {
        const id = `shot-${event.screenshot.path}`;
        const cellW = Math.max(20, Math.floor(state.width * 0.4));
        const cellH = 10;
        renderScreenshotToAnsi(event.screenshot.path, cellW, cellH)
          .then((ansi) => {
            dispatch({ type: 'activity-attach', id, screenshot: ansi });
          })
          .catch((err) => {
            dispatch({
              type: 'activity-attach',
              id,
              screenshot: { ansi: `[screenshot render failed: ${(err as Error).message}]`, width: cellW, height: 1, placeholder: true },
            });
          });
      }
    });
    return unsub;
  }, [core, state.paused, state.width]);

  useInput((input, key) => {
    if (key.ctrl && input === 'c') {
      onQuit?.();
      return;
    }
    if (key.return) {
      if (chatDraftRef.current.trim().length > 0) {
        onChatMessage?.(chatDraftRef.current);
        chatDraftRef.current = '';
        setChatDraftVersion((v) => v + 1);
      }
      return;
    }
    if (key.backspace || key.delete) {
      chatDraftRef.current = chatDraftRef.current.slice(0, -1);
      setChatDraftVersion((v) => v + 1);
      return;
    }
    if (key.tab) {
      dispatch({ type: 'toggle-paused' });
      return;
    }
    if (key.pageUp) {
      dispatch({ type: 'scroll-activity', delta: 5 });
      dispatch({ type: 'scroll-findings', delta: 5 });
      return;
    }
    if (key.pageDown) {
      dispatch({ type: 'scroll-activity', delta: -5 });
      dispatch({ type: 'scroll-findings', delta: -5 });
      return;
    }
    if (input && !key.ctrl && !key.meta) {
      chatDraftRef.current = chatDraftRef.current + input;
      setChatDraftVersion((v) => v + 1);
    }
  });

  return (
    <Box flexDirection="column" width={state.width} height={state.height}>
      <TuiView state={state} />
      {chatDraft ? <Text color="green">▎ {chatDraft}</Text> : null}
    </Box>
  );
}

/** Render the TUI against a HuntCore. Returns an unmount function. */
export function mountTui(core: HuntCore, opts: { onQuit?: () => void; onChatMessage?: (text: string) => void } = {}): () => void {
  const app = render(<TuiApp core={core} {...opts} />);
  return () => app.unmount();
}

/**
 * Build an initial TuiState from the current HuntCore state. This is
 * how a TUI that was attached AFTER a hunt had already started can
 * see findings, activity, and chat history that fired before mount.
 * In normal production the TUI mounts first; tests often record
 * events first, then mount the TUI, so this matters.
 */
function seedFromCore(core: HuntCore): TuiState {
  const s = core.getState();
  // Replay any events that fired before this TUI was mounted, so
  // the user sees chat messages, llm tokens, and activity that
  // happened while no listener was attached (tests, web dashboards,
  // late attach, etc.).
  const replayed = core.getRecentEvents().flatMap(eventToActions);
  let state: TuiState = {
    ...makeInitialState(),
    findings: s.findings.map((f): FindingView => ({
      id: f.id ?? `${f.type}-${f.endpoint}-${f.param ?? ''}`,
      type: f.type,
      severity: f.severity,
      endpoint: f.endpoint,
      param: f.param,
      confidence: String(f.confidence),
      description: f.description,
      observedAt: Date.now(),
    })),
    status: {
      ...makeInitialState().status,
      phase: s.phase ?? 'starting',
      findingsCount: s.findings.length,
      stepsCount: s.behavioralStepCount ?? 0,
      primitiveCalls: s.primitiveCallCount ?? 0,
      oobCallbacks: s.oobCallbackCount ?? 0,
    },
  };
  for (const action of replayed) {
    state = reduce(state, action);
  }
  return state;
}
