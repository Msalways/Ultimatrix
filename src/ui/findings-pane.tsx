/**
 * Findings pane — live table of findings from the store. Selecting a row opens
 * a modal with the finding detail + payload code block. This is a genuine
 * upgrade over the CLI, which had no live findings view (only an end-of-session
 * summary and a web-only panel). Reads `store.findings`; no writes.
 */

import { useState } from 'react'
import { Box, Text } from 'ink'
import { Table } from '@/components/ui/table'
import { Modal } from '@/components/ui/modal'
import { Code } from '@/components/ui/code'
import { useTheme } from '@/components/ui/theme-provider'
import type { UiStore, FindingRow } from './store'

export function FindingsPane({ store }: { store: UiStore }) {
  const theme = useTheme()
  const [selected, setSelected] = useState<FindingRow | null>(null)

  if (store.findings.length === 0) {
    return (
      <Box paddingX={1}>
        <Text dimColor color={theme.colors.mutedForeground}>
          No findings yet.
        </Text>
      </Box>
    )
  }

  const rows = store.findings.map((f) => ({
    id: f.id,
    severity: f.severity,
    technique: f.technique,
    endpoint: f.endpoint ?? '',
  }))

  return (
    <Box flexDirection="column" paddingX={1}>
      <Table
        data={rows}
        columns={[
          { key: 'severity', header: 'Severity', width: 10 },
          { key: 'technique', header: 'Technique', width: 24 },
          { key: 'endpoint', header: 'Endpoint', width: 40 },
        ]}
        selectable
        sortable
        onSelect={(row) => {
          const f = store.findings.find((x) => x.id === row.id)
          if (f) setSelected(f)
        }}
      />
      {selected && (
        <Modal open title={`${selected.severity.toUpperCase()} · ${selected.technique}`} onClose={() => setSelected(null)}>
          <Text color={theme.colors.foreground}>{selected.title}</Text>
          {selected.endpoint && (
            <Text color={theme.colors.mutedForeground}>{selected.endpoint}</Text>
          )}
          {selected.detail && <Code>{selected.detail}</Code>}
        </Modal>
      )}
    </Box>
  )
}
