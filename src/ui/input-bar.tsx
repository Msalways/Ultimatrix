/**
 * InputBar — the session's input surface. A `TextInput` for the goal, plus a
 * VS Code–style `CommandPalette` (Ctrl+K) over REPL commands. On submit it
 * calls the `onSubmit` callback wired in `main.tsx` to the REPL's `onInput`.
 * The prompt is owned here (not a raw `> ` write) — part of the single-owner fix.
 */

import { useState } from 'react'
import { Box, Text } from 'ink'
import { TextInput } from '@/components/ui/text-input'
import { CommandPalette } from '@/components/ui/command-palette'
import { useInput } from '@/hooks/use-input'
import { useTheme } from '@/components/ui/theme-provider'
import type { UiStore } from './store'

const COMMANDS = [
  { id: 'help', label: '/help', description: 'Show available commands', shortcut: 'Ctrl+K' },
  { id: 'reasoning', label: '/reasoning', description: 'Expand/collapse last reasoning block' },
  { id: 'report', label: '/report [id]', description: 'Write a Markdown report' },
  { id: 'council', label: '/council <goal>', description: 'Deliberate with the council' },
]

export function InputBar({ store, onSubmit }: { store: UiStore; onSubmit?: (line: string) => void }) {
  const theme = useTheme()
  const [paletteOpen, setPaletteOpen] = useState(false)

  useInput((_input, key) => {
    if (key.ctrl && _input === 'k') {
      setPaletteOpen((o) => !o)
    }
  })

  // When a free-text prompt (askUser / HITL) is pending, the InputBar submit
  // resolves it via the store instead of emitting a REPL goal. Single input
  // surface, routed by context — no second stdin pipe.
  const submit = (value: string) => {
    if (!value.trim()) return
    if (store.pendingInput) {
      store.resolveInput(value)
      return
    }
    onSubmit?.(value)
  }

  return (
    <Box flexDirection="column" borderStyle="single" borderColor={theme.colors.border} paddingX={1}>
      {store.pendingInput && (
        <Box flexDirection="row" gap={1} paddingBottom={1}>
          <Text color={theme.colors.warning}>{'❯ askUser:'}</Text>
          <Text wrap="wrap" color={theme.colors.foreground}>{store.pendingInput}</Text>
        </Box>
      )}
      {paletteOpen ? (
        <CommandPalette
          isOpen
          onClose={() => setPaletteOpen(false)}
          commands={COMMANDS.map((c) => ({
            ...c,
            onSelect: () => {
              submit(c.label)
            },
          }))}
        />
      ) : (
        <Box flexDirection="row" gap={1}>
          <Text bold color={store.pendingInput ? theme.colors.warning : theme.colors.primary}>{'>'}</Text>
          <TextInput
            autoFocus
            placeholder={store.pendingInput ? 'Type your answer…' : 'Type your goal, or Ctrl+K for commands…'}
            onSubmit={submit}
          />
        </Box>
      )}
    </Box>
  )
}
