import { Text } from 'silvery'
import { useState, useEffect } from 'react'
import type { TuiMessage } from './types'

const SPINNER_FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏']

interface Props {
  messages: TuiMessage[]
}

function StreamingSpinner() {
  const [frame, setFrame] = useState(0)

  useEffect(() => {
    const timer = setInterval(() => setFrame(f => (f + 1) % SPINNER_FRAMES.length), 80)
    return () => clearInterval(timer)
  }, [])

  return <Text color="gray">{SPINNER_FRAMES[frame]}</Text>
}

export function MessageList({ messages }: Props) {
  if (messages.length === 0) {
    return <Text color="gray">No messages yet. Type a message to start.</Text>
  }

  return (
    <Text>
      {messages.map((msg, i) => (
        <Text key={i}>
          {i > 0 ? '\n\n' : ''}
          <Text color={msg.role === 'user' ? 'cyan' : 'white'} bold>
            {msg.role === 'user' ? 'You' : 'Assistant'}
          </Text>
          {'\n'}
          <Text color={msg.role === 'user' ? 'cyan' : 'white'}>
            {msg.text || (msg.streaming ? <StreamingSpinner /> : null)}
            {msg.text && msg.streaming ? <Text color="gray">█</Text> : null}
          </Text>
        </Text>
      ))}
    </Text>
  )
}
