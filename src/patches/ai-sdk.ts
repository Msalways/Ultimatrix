/**
 * AI SDK Warning Suppression
 *
 * ROOT CAUSE:
 * Mastra's ToolLoopAgent.stream() (chunk-TOBPSKTN.js:12185) calls the internal
 * v5 streamText() WITHOUT passing allowSystemInMessages: true. When
 * standardizePrompt (line 6421) sees allowSystemInMessages === undefined with
 * system messages in the messages array, it fires a console.warn.
 *
 * WHY WE CAN'T FIX THIS CLEANLY:
 * - streamText is a LOCAL function in Mastra's chunk, NOT exported
 * - ToolLoopAgent is an internal class
 * - Mastra's AgentConfig does not expose allowSystemInMessages
 * - There is no config knob to suppress this at the Mastra level
 *
 * THE FIX:
 * We intercept console.warn and suppress this specific known-harmless warning.
 * This is the standard approach for suppressing third-party warnings when the
 * upstream doesn't expose a configuration option.
 *
 * SEE: AI SDK v5 standardizePrompt in ai/dist/index.js:1502
 *      Mastra's bundled copy in @mastra/core/dist/chunk-TOBPSKTN.js:6421
 *
 * This patch MUST be imported before any Mastra modules load.
 * Import it as the first side-effect in the CLI entry point.
 */

const SUPPRESSED_WARNINGS = [
  'System messages in the prompt or messages fields can be a security risk',
]

const originalWarn = console.warn.bind(console)

console.warn = (...args: any[]) => {
  const msg = typeof args[0] === 'string' ? args[0] : ''
  if (SUPPRESSED_WARNINGS.some(w => msg.includes(w))) return
  originalWarn(...args)
}
