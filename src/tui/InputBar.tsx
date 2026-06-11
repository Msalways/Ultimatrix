import { Box, Text, useInput } from 'silvery'
import { useRef, useEffect, useCallback } from 'react'

interface Props {
  value: string
  onChange: (value: string) => void
  onSubmit: (value: string) => void
  disabled: boolean
}

export function InputBar({ value, onChange, onSubmit, disabled }: Props) {
  const bufferRef = useRef(value)
  bufferRef.current = value

  const handleSubmit = useCallback(() => {
    const text = bufferRef.current.trim()
    if (!text) return
    onSubmit(text)
  }, [onSubmit])

  useInput((input, key) => {
    if (key.return) {
      handleSubmit()
      return
    }
    if (key.backspace || key.delete) {
      onChange(bufferRef.current.slice(0, -1))
      return
    }
    if (key.ctrl && input.toLowerCase() === 'c') {
      process.exit(0)
      return
    }
    if (input && !key.ctrl && !key.meta && !key.escape) {
      onChange(bufferRef.current + input)
    }
  })

  useEffect(() => {
    bufferRef.current = value
  }, [value])

  return (
    <Box>
      <Text color="cyan">{'> '}</Text>
      <Text>{value}</Text>
      <Text color="gray">█</Text>
      {disabled ? <Text color="gray"> (waiting...)</Text> : null}
    </Box>
  )
}
