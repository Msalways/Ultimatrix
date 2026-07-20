/**
 * Ink console entry point. Builds the UiStore, mounts the <App/> shell, and
 * bridges the InputBar to the REPL via `uiGoalEmitter` (so a typed goal drives
 * the existing `getLine` loop without a second stdin pipe). Exposes `unmount`
 * so the legacy session can tear the TUI down on exit. Reversible: when the
 * console is disabled, `main()` never calls this — the chat box path is intact.
 */

import React from 'react'
import { render, type RenderOptions } from 'ink'
import { App } from './app'
import { UiStore } from './store'
import { AutoThemeProvider } from '@/components/ui/theme-provider'
import { uiGoalEmitter } from '../tools/interaction-tools'

export interface ConsoleHandle {
  store: UiStore
  unmount: () => void
}

/**
 * Mount the full-screen Ink console.
 *
 * The console is the SOLE owner of the terminal in console mode:
 *  - `alternateScreen: true` takes over the whole screen and restores it on exit.
 *  - `exitOnCtrlC: false` leaves Ctrl+C to the session's SIGINT handler (graceful
 *    shutdown), instead of Ink hard-killing the process mid-solve.
 *  - Ink claims `process.stdin` in raw mode by default, so the legacy readline
 *    MUST NOT be attached to stdin in console mode (see lifecycle.ts). That is
 *    the structural fix for the previous "typing goes to the terminal" bug — a
 *    single stdin owner, not two systems fighting over the same fd.
 */
export function startConsole(store: UiStore): ConsoleHandle {
  const options: RenderOptions = {
    alternateScreen: true,
    exitOnCtrlC: false,
    patchConsole: true,
  }
  const { unmount } = render(
    <AutoThemeProvider>
      <App onSubmit={(line) => uiGoalEmitter.emit('goal', line)} />
    </AutoThemeProvider>,
    options,
  )
  return { store, unmount }
}
