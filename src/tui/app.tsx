// src/tui/app.tsx
//
// Ink entry point. Subscribes to a HuntCore's event stream, dispatches
// events to a reducer, and renders the 4-pane view. Handles SIGINT
// gracefully. Uses stdin for chat input (so the user can steer).

import React, { useEffect, useState, useReducer } from 'react';
import { render, Box, Text, useInput } from 'ink';
import { TuiView } from './view';
import { makeInitialState, reduce, eventToActions } from './state';
import type { HuntEvent } from '../hunt/events';
import type { HuntCore } from '../hunt/core';

export interface TuiAppProps {
  core: HuntCore;
  onQuit?: () => void;
  onChatMessage?: (text: string) => void;
  /** Snapshot of current state for external inspection. */
  onState?: (state: ReturnType<typeof makeInitialState>) => void;
}

export function TuiApp({ core, onQuit, onChatMessage, onState }: TuiAppProps): React.ReactElement {
  const [state, dispatch] = useReducer(reduce, undefined, makeInitialState);
  const [chatDraft, setChatDraft] = useState('');
  const [paused, setPaused] = useState(false);

  useEffect(() => {
    if (onState) onState(state);
  }, [state, onState]);

  useEffect(() => {
    const unsub = core.on((event: HuntEvent) => {
      if (paused) return;
      const actions = eventToActions(event);
      for (const a of actions) dispatch(a);
    });
    return unsub;
  }, [core, paused]);

  useInput((input, key) => {
    if (key.ctrl && input === 'c') {
      onQuit?.();
    } else if (key.return) {
      if (chatDraft.trim().length > 0) {
        onChatMessage?.(chatDraft);
        setChatDraft('');
      }
    } else if (key.backspace || key.delete) {
      setChatDraft((s) => s.slice(0, -1));
    } else if (key.tab) {
      setPaused((p) => !p);
    } else if (input && !key.ctrl && !key.meta) {
      setChatDraft((s) => s + input);
    }
  });

  return (
    <Box flexDirection="column">
      <TuiView state={state} />
      {paused ? <Text color="yellow">[paused — tab to resume]</Text> : null}
      {chatDraft ? <Text color="green">▎ {chatDraft}</Text> : null}
    </Box>
  );
}

/** Render the TUI against a HuntCore. Returns an unmount function. */
export function mountTui(core: HuntCore, opts: { onQuit?: () => void; onChatMessage?: (text: string) => void } = {}): () => void {
  const app = render(<TuiApp core={core} {...opts} />);
  return () => app.unmount();
}
