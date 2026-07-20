/**
 * Ink-store adapter of the `ActivitySink` contract. Every write the legacy
 * `ChatBox` used to push to raw stdout is routed here into the `UiStore`
 * instead. The Ink panes subscribe to the store, so nothing is written directly
 * to the terminal — this is the structural fix for the "subsystems dumping
 * independently" root cause.
 */

import { getUiStore, type UiStore } from './store'
import type { ActivitySink, BannerInfo } from './types'

export class UiActivity implements ActivitySink {
  constructor(private store: UiStore = getUiStore()) {}

  printBanner(info: BannerInfo): void {
    this.store.setStatus({
      engine: info.engine,
      target: info.target,
      provider: info.model.split('/')[0],
    })
  }

  printSystem(msg: string, level: 'info' | 'dim' | 'warn' | 'error' = 'info'): void {
    // System events surface in the chat pane as `system` chat messages so they
    // are visible and scrollable, never raw stdout noise.
    this.store.dispatchSolver({
      kind: 'tool',
      name: `system:${level}`,
      args: { message: msg },
    } as any)
  }

  printHelp(_text: string): void {
    // Help is rendered by the command palette / help pane in the Ink app; the
    // raw text is not needed here. Kept for interface symmetry.
  }

  printReport(text: string): void {
    this.store.dispatchSolver({
      kind: 'tool',
      name: 'report',
      args: { message: text },
    } as any)
  }

  beginActivity(label: string): void {
    this.store.setSpiderActivity({
      id: 'spider-root',
      name: label,
      state: 'start',
      detail: 'starting…',
    })
  }

  updateActivity(text: string): void {
    this.store.setSpiderActivity({
      id: 'spider-root',
      name: 'Spider',
      state: 'start',
      detail: text.slice(-200),
    })
  }

  endActivity(status: 'ok' | 'err' = 'ok'): void {
    this.store.setSpiderActivity({
      id: 'spider-root',
      name: 'Spider',
      state: status,
    })
  }

  flushSystem(): void {
    // No buffering in store mode — system events are already materialized.
  }
}
