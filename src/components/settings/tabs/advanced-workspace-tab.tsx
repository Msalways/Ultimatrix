'use client'

import { GeneralTab } from './general-tab'
import { BrowserTab } from './browser-tab'
import { SolverTab } from './solver-tab'
import { BudgetTab } from './budget-tab'
import { AdvancedTab } from './advanced-tab'

export function AdvancedWorkspaceTab() {
  return (
    <div className="space-y-8">
      <section>
        <div className="mb-3 text-xs font-medium text-zinc-300">General runtime</div>
        <GeneralTab />
      </section>
      <section>
        <div className="mb-3 text-xs font-medium text-zinc-300">Browser and spider</div>
        <BrowserTab />
      </section>
      <section>
        <div className="mb-3 text-xs font-medium text-zinc-300">Solver behavior</div>
        <SolverTab />
      </section>
      <section>
        <div className="mb-3 text-xs font-medium text-zinc-300">Budget and rate limits</div>
        <BudgetTab />
      </section>
      <section>
        <div className="mb-3 text-xs font-medium text-zinc-300">Specialized internals</div>
        <AdvancedTab />
      </section>
    </div>
  )
}

