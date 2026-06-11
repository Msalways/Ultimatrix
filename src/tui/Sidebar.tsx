import { Box, Text } from 'silvery'
import { ActivityLog } from './ActivityLog'
import { GraphStats } from './GraphStats'
import type { TuiActivity, TuiGraphStats } from './types'

interface Props {
  activities: TuiActivity[]
  graphStats: TuiGraphStats
}

export function Sidebar({ activities, graphStats }: Props) {
  return (
    <Box flexDirection="column" flexGrow={3} paddingX={1}>
      <Box flexGrow={1} borderStyle="round" borderColor="#555" paddingX={1}>
        <Text bold color="#888">Activity</Text>
        {'\n'}
        <ActivityLog activities={activities} />
      </Box>
      <Box flexGrow={1} borderStyle="round" borderColor="#555" paddingX={1} marginTop={1}>
        <Text bold color="#888">Graph Stats</Text>
        {'\n'}
        <GraphStats stats={graphStats} />
      </Box>
    </Box>
  )
}
