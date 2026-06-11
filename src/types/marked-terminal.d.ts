declare module 'marked-terminal' {
  import type { Renderer } from 'marked'
  class TerminalRenderer extends Renderer {
    constructor(options?: Record<string, unknown>)
  }
  export default TerminalRenderer
  export const markedTerminal: unknown
}
