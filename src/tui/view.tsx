// src/tui/view.tsx
//
// 4-pane Ink view:
//   ┌─ status ─────────────────────────┐
//   │ phase / time / cost / counts     │
//   ├─ live activity ──┬─ findings ────┤
//   │ step / primitive │ type / sev    │
//   │ / finding / OOB  │               │
//   ├──────────────────┼───────────────┤
//   │ chat (read-only)                 │
//   └──────────────────────────────────┘

import React from 'react';
import { Box, Text } from 'ink';
import type { TuiState, FindingView, ActivityLine } from './state';
import { formatStatusLine, formatFindingLine } from './state';

export interface TuiViewProps {
  state: TuiState;
}

export function TuiView({ state }: TuiViewProps): React.ReactElement {
  const leftW = Math.floor(state.width * 0.6) - 1;
  const rightW = state.width - leftW - 1;
  const chatH = 7;
  const topH = state.height - chatH - 1;
  const leftH = topH;

  return (
    <Box flexDirection="column" width={state.width} height={state.height}>
      <Box flexDirection="row" width={state.width} height={topH}>
        <StatusBar state={state} />
        <ActivityPane state={state} width={leftW} height={leftH} />
        <FindingsPane state={state} width={rightW} height={leftH} />
      </Box>
      <ChatPane state={state} width={state.width} height={chatH} />
    </Box>
  );
}

function StatusBar({ state }: { state: TuiState }): React.ReactElement {
  const line = formatStatusLine(state.status);
  return (
    <Box width={state.width} borderStyle="single" paddingX={1}>
      <Text color="cyan">{line}</Text>
    </Box>
  );
}

function ActivityPane({ state, width, height }: { state: TuiState; width: number; height: number }): React.ReactElement {
  const visible = state.activity.slice(-Math.max(1, height - 2));
  return (
    <Box flexDirection="column" width={width} height={height} borderStyle="single" paddingX={1}>
      <Text bold color="yellow">▎ activity</Text>
      {visible.map((l) => <ActivityRow key={l.id} line={l} width={width - 2} />)}
    </Box>
  );
}

function ActivityRow({ line, width }: { line: ActivityLine; width: number }): React.ReactElement {
  const truncated = line.text.length > width ? line.text.slice(0, width - 1) + '…' : line.text;
  const color = line.level === 'error' ? 'red' : line.level === 'warn' ? 'yellow' : line.level === 'success' ? 'green' : line.level === 'agent' ? 'magenta' : 'gray';
  return <Text color={color}>{truncated}</Text>;
}

function FindingsPane({ state, width, height }: { state: TuiState; width: number; height: number }): React.ReactElement {
  const visible = state.findings.slice(0, Math.max(1, height - 2));
  return (
    <Box flexDirection="column" width={width} height={height} borderStyle="single" paddingX={1}>
      <Text bold color="red">▎ findings ({state.findings.length})</Text>
      {visible.length === 0 ? <Text dimColor>none yet</Text> : visible.map((f) => <FindingRow key={f.id} f={f} width={width - 2} />)}
    </Box>
  );
}

function FindingRow({ f, width }: { f: FindingView; width: number }): React.ReactElement {
  const line = formatFindingLine(f);
  const truncated = line.length > width ? line.slice(0, width - 1) + '…' : line;
  const color = f.severity === 'critical' ? 'red' : f.severity === 'high' ? 'red' : f.severity === 'medium' ? 'yellow' : 'white';
  return <Text color={color} bold>{truncated}</Text>;
}

function ChatPane({ state, width, height }: { state: TuiState; width: number; height: number }): React.ReactElement {
  const visible = state.chat.slice(-Math.max(1, height - 3));
  return (
    <Box flexDirection="column" width={width} height={height} borderStyle="single" paddingX={1}>
      <Text bold color="cyan">▎ chat (type / for slash commands)</Text>
      {visible.map((c, i) => {
        const truncated = c.text.length > width - 12 ? c.text.slice(0, width - 13) + '…' : c.text;
        const color = c.role === 'user' ? 'green' : c.role === 'system' ? 'gray' : 'blue';
        return <Text key={i} color={color}>{c.role}: {truncated}</Text>;
      })}
      {state.streamingText ? <Text color="cyan">▎ {state.streamingText.source}: {state.streamingText.text.slice(-200)}</Text> : null}
    </Box>
  );
}
