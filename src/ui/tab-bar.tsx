/**
 * TabBar — a minimal tab strip composed from termcn primitives (Box + Text +
 * useInput) instead of the termcn `tabs` component, which issues a raw
 * `stdout.write("\u001B[2J\u001B[H")` full-screen clear on switch. Inside an Ink
 * managed render loop that raw clear would fight Ink's cursor ownership, so we
 * render the strip declaratively and let the store own the active tab. This is
 * the non-bandaid choice: one owner (Ink) of the screen.
 */

import { Box, Text } from 'ink'
import { useInput } from '@/hooks/use-input'
import { useTheme } from '@/components/ui/theme-provider'
import type { TabKey, UiStore } from './store'

// Full ordered list (includes Status). Number keys 1–5 map to these.
const ORDER: TabKey[] = ['chat', 'findings', 'spider', 'tools', 'status']

export function TabBar({ store, tabs }: { store: UiStore; tabs: { key: TabKey; label: string; content: React.ReactNode }[] }) {
  const theme = useTheme()

  // Keyboard nav. Plain arrows and digits are intentionally NOT bound here: the
  // InputBar's TextInput owns those for in-line editing, and global useInput
  // fires even while typing. Only modifier combos that TextInput ignores are
  // used, so navigation never hijacks text entry:
  //   Tab / Shift+Tab  → cycle tabs forward / back
  //   Ctrl+← / Ctrl+→  → previous / next tab
  // Ink has no mouse; these are the structured, keyboard-only interactions.
  useInput((_input, key) => {
    const idx = ORDER.indexOf(store.activeTab)
    const prev = () => store.setTab(ORDER[(idx - 1 + ORDER.length) % ORDER.length])
    const next = () => store.setTab(ORDER[(idx + 1) % ORDER.length])
    if (key.tab && key.shift) prev()
    else if (key.tab) next()
    else if (key.ctrl && key.leftArrow) prev()
    else if (key.ctrl && key.rightArrow) next()
  })

  return (
    <Box flexDirection="row" gap={0} paddingX={1} borderStyle="single" borderColor={theme.colors.border}>
      {tabs.map((t, i) => {
        const isActive = t.key === store.activeTab
        return (
          <Box key={t.key}>
            <Text
              color={isActive ? theme.colors.primary : theme.colors.mutedForeground}
              bold={isActive}
              underline={isActive}
            >
              {` ${t.label} `}
            </Text>
            {i < tabs.length - 1 && (
              <Text color={theme.colors.border}> │ </Text>
            )}
          </Box>
        )
      })}
    </Box>
  )
}
