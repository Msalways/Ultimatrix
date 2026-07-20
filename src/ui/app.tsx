/**
 * App — the full-screen terminal console shell.
 *
 * Layout (top → bottom):
 *   TopBar            status strip (engine / target / steps / tools / quota)
 *   TabBar            Chat | Findings | Spider | Tools   (panes swap on change)
 *   <active pane>     only the active pane is mounted
 *   Approval overlay  HITL tool-approval prompt (when a request is pending)
 *   InputBar          goal text input + command palette
 *
 * Every pane reads the single UiStore; this component only composes layout
 * and forwards tab/approval events back into the store. No subsystem writes
 * to the screen directly — that is the structural root-cause fix.
 */

import { Box } from 'ink'
import { useTheme } from '@/components/ui/theme-provider'
import { useUiStore } from './use-store'
import { TopBar } from './topbar'
import { TabBar } from './tab-bar'
import { ChatPane } from './chat-pane'
import { FindingsPane } from './findings-pane'
import { SpiderPane } from './spider-pane'
import { ToolsPane } from './tools-pane'
import { StatusPane } from './status-pane'
import { ApprovalOverlay } from './approval'
import { InputBar } from './input-bar'
import type { TabKey } from './store'

export function App({ onSubmit }: { onSubmit?: (line: string) => void }) {
  const theme = useTheme()
  const store = useUiStore()

  const tabs = [
    { key: 'chat' as TabKey, label: 'Chat', content: <ChatPane store={store} /> },
    { key: 'findings' as TabKey, label: 'Findings', content: <FindingsPane store={store} /> },
    { key: 'spider' as TabKey, label: 'Spider', content: <SpiderPane store={store} /> },
    { key: 'tools' as TabKey, label: 'Tools', content: <ToolsPane store={store} /> },
    { key: 'status' as TabKey, label: 'Status', content: <StatusPane store={store} /> },
  ]

  const active = tabs.find((t) => t.key === store.activeTab) ?? tabs[0]

  return (
    <Box flexDirection="column" height="100%" backgroundColor={theme.colors.background}>
      <TopBar store={store} />
      <TabBar store={store} tabs={tabs} />
      <Box flexGrow={1} flexDirection="column">
        {active.content}
      </Box>
      {store.approval && <ApprovalOverlay store={store} />}
      <InputBar store={store} onSubmit={onSubmit} />
    </Box>
  )
}
