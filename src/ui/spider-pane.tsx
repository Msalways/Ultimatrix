/**
 * Spider pane — live crawl activity. Shows the running activity (Spinner) plus
 * a ProgressBar of endpoints/pages/findings and a ToolCall row per activity.
 * Reads `store.spider` + `store.spiderCounts`; no writes.
 */

import { Box, Text } from 'ink'
import { Spinner } from '@/components/ui/spinner'
import { ProgressBar } from '@/components/ui/progress-bar'
import { ToolCall } from '@/components/ui/tool-call'
import { useTheme } from '@/components/ui/theme-provider'
import type { UiStore } from './store'

export function SpiderPane({ store }: { store: UiStore }) {
  const theme = useTheme()
  const { spiderCounts: c } = store

  const running = store.spider.some((a) => a.state === 'start')

  return (
    <Box flexDirection="column" paddingX={1} gap={1}>
      <Box gap={1}>
        {running && <Spinner />}
        <Text bold color={theme.colors.primary}>Spider</Text>
      </Box>

      <ProgressBar label="endpoints" value={c.endpoints} total={Math.max(c.endpoints, 1)} width={24} />
      <ProgressBar label="pages" value={c.pages} total={Math.max(c.pages, 1)} width={24} />
      <ProgressBar label="findings" value={c.findings} total={Math.max(c.findings, 1)} width={24} showPercent={false} />

      <Box flexDirection="column">
        {store.spider.length === 0 ? (
          <Text dimColor color={theme.colors.mutedForeground}>
            No crawl activity yet.
          </Text>
        ) : (
          store.spider.slice(-12).map((a) => (
            <ToolCall
              key={a.id}
              name={a.name}
              status={a.state === 'start' ? 'running' : a.state === 'ok' ? 'success' : 'error'}
              result={a.detail}
              defaultCollapsed
            />
          ))
        )}
      </Box>
    </Box>
  )
}
