/**
 * Tools pane — discovered tools with their last result. Uses the termcn `List`
 * (filterable, selectable). Reads `store.tools`; no writes.
 */

import { Box, Text } from 'ink'
import { List, type ListItem } from '@/components/ui/list'
import { useTheme } from '@/components/ui/theme-provider'
import type { UiStore } from './store'

export function ToolsPane({ store }: { store: UiStore }) {
  const theme = useTheme()

  if (store.tools.length === 0) {
    return (
      <Box paddingX={1}>
        <Text dimColor color={theme.colors.mutedForeground}>
          No tools discovered yet.
        </Text>
      </Box>
    )
  }

  const items: ListItem[] = store.tools.map((t) => ({
    key: t.name,
    label: t.name,
    description: t.lastResult,
    color: t.lastState === 'err' ? theme.colors.error : undefined,
  }))

  return (
    <Box paddingX={1}>
      <List items={items} filterable height={Math.max(6, items.length)} />
    </Box>
  )
}
