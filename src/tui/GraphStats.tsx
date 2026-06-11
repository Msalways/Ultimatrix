import { Text } from 'silvery'
import type { TuiGraphStats } from './types'

interface Props {
  stats: TuiGraphStats
}

export function GraphStats({ stats }: Props) {
  const items: [string, number, string][] = [
    ['Pages', stats.pages, 'green'],
    ['Actions', stats.actions, 'green'],
    ['Tests', stats.tests, 'green'],
    ['Findings', stats.findings, stats.findings > 0 ? 'red' : 'green'],
    ['Auth Flows', stats.authFlows, 'green'],
    ['RBAC Roles', stats.rbacRoles, 'green'],
  ]

  return (
    <Text>
      {items.map(([label, value, color]) => (
        <Text key={label}>
          {label}: <Text color={color}>{value}</Text>
          {'\n'}
        </Text>
      ))}
    </Text>
  )
}
