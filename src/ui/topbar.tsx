/**
 * TopBar — session status strip: engine / target / steps / tools / quota.
 * Reads `store.status` (single source of truth). Pure read; no writes.
 */

import { Box, Text } from 'ink'
import { Badge } from '@/components/ui/badge'
import { Gauge } from '@/components/ui/gauge'
import { useTheme } from '@/components/ui/theme-provider'
import type { UiStore } from './store'

export function TopBar({ store }: { store: UiStore }) {
  const theme = useTheme()
  const s = store.status
  const stepsPct = s.maxSteps && s.maxSteps > 0
    ? Math.min(1, s.step / s.maxSteps)
    : 0

  return (
    <Box flexDirection="row" gap={1} paddingX={1} borderStyle="single" borderColor={theme.colors.border}>
      {s.engine && <Badge variant="info">{s.engine}</Badge>}
      {s.target && (
        <Box gap={1}>
          <Text dimColor color={theme.colors.mutedForeground}>target</Text>
          <Text color={theme.colors.foreground}>{s.target}</Text>
        </Box>
      )}
      <Gauge value={stepsPct} size="sm" label={`${s.step}${s.maxSteps ? '/' + s.maxSteps : ''} steps`} />
      <Badge variant="secondary">tools: {s.tools}</Badge>
      {s.quota && <Badge variant="warning">{s.quota}</Badge>}
    </Box>
  )
}
