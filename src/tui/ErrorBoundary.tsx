import { Component, type ReactNode } from 'react'
import { Text } from 'silvery'

interface Props {
  children: ReactNode
}

interface State {
  hasError: boolean
  error?: Error
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error }
  }

  render() {
    if (this.state.hasError) {
      return (
        <Text color="red">
          Something went wrong:{'\n'}
          {this.state.error?.message ?? 'Unknown error'}
        </Text>
      )
    }
    return this.props.children
  }
}
