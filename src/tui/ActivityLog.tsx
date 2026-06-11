import { Text } from 'silvery'
import type { TuiActivity } from './types'

const colorMap: Record<string, string> = {
  START: '#888',
  DONE: 'green',
  ERROR: 'red',
  FIND: 'yellow',
  SPIDER: 'blue',
  WARN: '#ff8800',
}

interface Props {
  activities: TuiActivity[]
}

export function ActivityLog({ activities }: Props) {
  if (activities.length === 0) {
    return <Text color="gray">No activity yet...</Text>
  }

  const recent = activities.slice(-100)

  return (
    <Text>
      {recent.map((a, i) => (
        <Text key={i}>
          {i > 0 ? '\n' : ''}
          <Text color={colorMap[a.type] || 'white'} bold>
            [{a.type}]
          </Text>
          {' '}
          <Text color={colorMap[a.type] || 'white'}>{a.message}</Text>
        </Text>
      ))}
    </Text>
  )
}
