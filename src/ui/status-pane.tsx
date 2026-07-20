/**
 * Status pane — engine/provider/target context, live step/tool counters, and the
 * recent system log lines (logger sink forwards here in console mode so the Ink
 * screen stays clean). Reads `store.status` + `store.logLines`; no writes.
 */

import { Box, Text, useStdout } from 'ink'
import { ScrollView } from '@/components/ui/scroll-view'
import { useTheme } from '@/components/ui/theme-provider'
import type { UiStore } from './store'

export function StatusPane({ store }: { store: UiStore }) {
  const theme = useTheme()
  const { stdout } = useStdout()
  const { model, status, logLines } = store

  const height = Math.max(0, (stdout?.rows ?? 24) - 7)

  return (
    <Box flexDirection="column" paddingX={1} gap={1}>
      <Box flexDirection="column">
        <Text bold color={theme.colors.primary}>Session</Text>
        <Text>engine: {model.engine ?? '—'}</Text>
        <Text>provider: {model.provider ?? '—'}</Text>
        <Text>target: {model.target ?? '—'}</Text>
      </Box>
      <Box flexDirection="column">
        <Text bold color={theme.colors.primary}>Live</Text>
        <Text>step: {status.step} · tools: {status.tools}</Text>
        <Text>spider — endpoints: {store.spiderCounts.endpoints} · pages: {store.spiderCounts.pages} · findings: {store.spiderCounts.findings}</Text>
        <Text>tools discovered: {store.tools.length} · findings: {store.findings.length}</Text>
      </Box>
      <Box flexDirection="column" flexGrow={1}>
        <Text bold color={theme.colors.primary}>Log</Text>
        <ScrollView height={Math.max(4, height - 8)} flexDirection="column">
          {logLines.length === 0 ? (
            <Text dimColor color={theme.colors.mutedForeground}>No log output yet.</Text>
          ) : (
            logLines.slice(-40).map((l, i) => (
              <Text key={`log-${i}`} wrap="truncate-end">{l}</Text>
            ))
          )}
        </ScrollView>
      </Box>
    </Box>
  )
}
