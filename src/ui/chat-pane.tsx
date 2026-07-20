/**
 * Chat pane — renders the solver `RenderModel`s from the store as a scrollable
 * transcript of `chat-message` rows. One source of truth: the store folds the
 * stream exactly once; this pane only reads it. No re-folding, no raw writes.
 * Renders completed `turns` (history) followed by the live `model`.
 */

import React from 'react'
import { Box, Text, useStdout } from 'ink'
import { ChatMessage } from '@/components/ui/chat-message'
import { Markdown } from '@/components/ui/markdown'
import { ToolCall } from '@/components/ui/tool-call'
import { ScrollView } from '@/components/ui/scroll-view'
import { useTheme } from '@/components/ui/theme-provider'
import type { UiStore } from './store'
import { argsSummary, resultSummary, type RenderModel } from '../output/render-model'

function renderModel(model: RenderModel, keyPrefix: string, theme: ReturnType<typeof useTheme>): React.ReactNode[] {
  const nodes: React.ReactNode[] = []

  if (model.reasoning.trim()) {
    nodes.push(
      <ChatMessage
        key={`${keyPrefix}-reasoning`}
        sender="system"
        name="reasoning"
        collapsed
      >
        {model.reasoning}
      </ChatMessage>,
    )
  }

  for (const t of model.tools) {
    nodes.push(
      <ToolCall
        key={`${keyPrefix}-tool-${t.id}`}
        name={t.name}
        status={t.state === 'start' ? 'running' : t.state === 'ok' ? 'success' : 'error'}
        args={t.args}
        result={resultSummary(t.result) || undefined}
        defaultCollapsed
      />,
    )
  }

  if (model.answer.trim()) {
    nodes.push(
      <Box key={`${keyPrefix}-answer`} flexDirection="column" marginBottom={1}>
        <Text bold color={theme.colors.success}>assistant</Text>
        <Markdown>{model.answer}</Markdown>
      </Box>,
    )
  }

  if (model.complete && model.done) {
    nodes.push(
      <Box key={`${keyPrefix}-footer`} borderStyle="single" borderColor={theme.colors.border} paddingX={1}>
        <Text dimColor color={theme.colors.mutedForeground}>
          {`── done · ${model.done.steps ?? model.step} steps · ${model.done.toolCalls ?? model.tools.length} tools ──`}
        </Text>
      </Box>,
    )
  }

  return nodes
}

export function ChatPane({ store }: { store: UiStore }) {
  const theme = useTheme()
  const { stdout } = useStdout()

  const height = Math.max(0, (stdout?.rows ?? 24) - 7)

  const children: React.ReactNode[] = []
  store.turns.forEach((turn, i) => {
    for (const node of renderModel(turn, `t${i}`, theme)) children.push(node)
  })
  for (const node of renderModel(store.model, 'live', theme)) children.push(node)

  return (
    <ScrollView height={height} flexDirection="column">
      {children.length > 0 ? (
        children
      ) : (
        <Text dimColor color={theme.colors.mutedForeground}>
          {'No activity yet. Send a goal to the solver.'}
        </Text>
      )}
    </ScrollView>
  )
}
