// src/tui/view.tsx
//
// 4-pane Ink view:
//   ┌─ status ─────────────────────────┐
//   │ phase / time / cost / counts     │   (phase-coloured, with a
//   │ + scroll/scroll indicator        │    pulsing-style "●" marker)
//   ├─ live activity ──┬─ findings ────┤
//   │ step / primitive │ type / sev    │   (timestamped, scrollable,
//   │ / finding / OOB  │               │    inline screenshot ANSI)
//   ├──────────────────┼───────────────┤
//   │ chat (history + streaming)       │
//   ├──────────────────────────────────┤
//   │ key hints (tab/enter/pgup/^C)    │   (dim, full width)
//   └──────────────────────────────────┘

import React from 'react';
import { Box, Text } from 'ink';
import type { TuiState, FindingView, ActivityLine, RenderedScreenshot } from './state';
import { formatStatusLine, formatFindingLine, formatClock, formatLevelBadge, phaseColor } from './state';

export interface TuiViewProps {
  state: TuiState;
}

export function TuiView({ state }: TuiViewProps): React.ReactElement {
  const chatH = 6;
  const footerH = 1;
  const topH = Math.max(4, state.height - chatH - footerH - 1);
  const leftW = Math.max(20, Math.floor(state.width * 0.6) - 1);
  const rightW = Math.max(16, state.width - leftW - 1);

  return (
    <Box flexDirection="column" width={state.width} height={state.height}>
      <Box flexDirection="row" width={state.width} height={topH}>
        <StatusBar state={state} />
        <ActivityPane state={state} width={leftW} height={topH} />
        <FindingsPane state={state} width={rightW} height={topH} />
      </Box>
      <ChatPane state={state} width={state.width} height={chatH} />
      <KeyHints width={state.width} />
    </Box>
  );
}

function StatusBar({ state }: { state: TuiState }): React.ReactElement {
  const line = formatStatusLine(state.status);
  const pc = phaseColor(state.status.phase);
  const running = state.status.phase !== 'starting' && state.status.phase !== 'done' && state.status.phase !== 'complete' && !state.paused;
  return (
    <Box width={state.width} borderStyle="single" paddingX={1} flexDirection="row">
      {running ? <Text color="green">● </Text> : <Text dimColor>  </Text>}
      {state.paused ? <Text color="yellow">⏸ </Text> : null}
      <Text color={pc} bold>{line}</Text>
    </Box>
  );
}

function ActivityPane({ state, width, height }: { state: TuiState; width: number; height: number }): React.ReactElement {
  const innerH = Math.max(1, height - 2);
  const visible = windowActivity(state, innerH);
  const scrolled = state.activityScroll > 0;
  const count = state.activity.length;
  const header = scrolled
    ? `▎ activity (${count})  ↑ -${state.activityScroll}`
    : `▎ activity (${count})`;
  return (
    <Box flexDirection="column" width={width} height={height} borderStyle="single" paddingX={1}>
      <Text bold color="yellow">{header}</Text>
      {visible.length === 0 && count === 0 ? <Text dimColor>(no activity yet)</Text> : null}
      {visible.map((l) => <ActivityRow key={l.id} line={l} width={width - 2} />)}
    </Box>
  );
}

/** Pick a slice of activity lines respecting activityScroll. */
function windowActivity(state: TuiState, height: number): ActivityLine[] {
  const total = state.activity.length;
  if (total === 0 || height <= 0) return [];
  const end = total - state.activityScroll;
  const start = Math.max(0, end - height);
  return state.activity.slice(start, end);
}

function ActivityRow({ line, width }: { line: ActivityLine; width: number }): React.ReactElement {
  const clock = formatClock(line.timestamp);
  const badge = formatLevelBadge(line.level);
  const color = line.level === 'error' ? 'red' : line.level === 'warn' ? 'yellow' : line.level === 'success' ? 'green' : line.level === 'agent' ? 'magenta' : 'gray';
  // width includes 2 padding chars (1 each side). Reserve 9 for clock+badge+space.
  const textW = Math.max(0, width - 11);
  const truncated = line.text.length > textW ? line.text.slice(0, textW - 1) + '…' : line.text;
  return (
    <Box flexDirection="column">
      <Box flexDirection="row">
        <Text dimColor>{clock} </Text>
        <Text color={color}>{badge} </Text>
        <Text color={color}>{truncated}</Text>
      </Box>
      {line.screenshot ? <ScreenshotInline ansi={line.screenshot} /> : null}
    </Box>
  );
}

function ScreenshotInline({ ansi }: { ansi: RenderedScreenshot }): React.ReactElement {
  if (ansi.placeholder) {
    return <Text dimColor>  └ {ansi.ansi.trim()}</Text>;
  }
  // Use Text with dangerouslyAllowRawTextSupport so ANSI escapes render.
  // Ink will treat the multi-line ANSI block as a single string.
  return (
    <Box marginLeft={2} flexDirection="column">
      <Text>{ansi.ansi}</Text>
    </Box>
  );
}

function FindingsPane({ state, width, height }: { state: TuiState; width: number; height: number }): React.ReactElement {
  const innerH = Math.max(1, height - 2);
  const visible = windowFindings(state, innerH);
  const scrolled = state.findingsScroll > 0;
  const count = state.findings.length;
  const header = scrolled ? `▎ findings (${count})  ↑ -${state.findingsScroll}` : `▎ findings (${count})`;
  return (
    <Box flexDirection="column" width={width} height={height} borderStyle="single" paddingX={1}>
      <Text bold color="red">{header}</Text>
      {visible.length === 0 ? <Text dimColor>(none yet)</Text> : visible.map((f) => <FindingRow key={f.id} f={f} width={width - 2} />)}
    </Box>
  );
}

function windowFindings(state: TuiState, height: number): FindingView[] {
  const total = state.findings.length;
  if (total === 0 || height <= 0) return [];
  const end = total - state.findingsScroll;
  const start = Math.max(0, end - height);
  return state.findings.slice(start, end);
}

function FindingRow({ f, width }: { f: FindingView; width: number }): React.ReactElement {
  const line = formatFindingLine(f);
  const textW = Math.max(0, width);
  const truncated = line.length > textW ? line.slice(0, textW - 1) + '…' : line;
  const color = f.severity === 'critical' ? 'red' : f.severity === 'high' ? 'red' : f.severity === 'medium' ? 'yellow' : 'white';
  return <Text color={color} bold>{truncated}</Text>;
}

function ChatPane({ state, width, height }: { state: TuiState; width: number; height: number }): React.ReactElement {
  const innerH = Math.max(1, height - 2);
  const visible = state.chat.slice(-Math.max(1, innerH));
  return (
    <Box flexDirection="column" width={width} height={height} borderStyle="single" paddingX={1}>
      <Text bold color="cyan">▎ chat ({state.chat.length})</Text>
      {visible.length === 0 ? <Text dimColor>(no messages)</Text> : null}
      {visible.map((c, i) => {
        const truncated = c.text.length > width - 12 ? c.text.slice(0, width - 13) + '…' : c.text;
        const color = c.role === 'user' ? 'green' : c.role === 'system' ? 'gray' : 'blue';
        return <Text key={i} color={color}>{c.role}: {truncated}</Text>;
      })}
      {state.streamingText ? <Text color="cyan">  ▎ {state.streamingText.source}: {state.streamingText.text.slice(-200)}</Text> : null}
    </Box>
  );
}

function KeyHints({ width }: { width: number }): React.ReactElement {
  return (
    <Box width={width} paddingX={1}>
      <Text dimColor>tab: pause  |  enter: send  |  pgup/pgdn: scroll  |  ^C: quit</Text>
    </Box>
  );
}
