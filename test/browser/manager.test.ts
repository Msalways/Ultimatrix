import { describe, expect, it } from 'vitest'
import { DEFAULTS } from '../../src/config'
import { getOrCreateBrowser } from '../../src/browser/manager'
import { wrapStagehandTools } from '../../src/browser/dialog-inject'

describe('shared browser manager', () => {
  it('keeps browser shutdown under host control', () => {
    const browser = getOrCreateBrowser({
      ...DEFAULTS,
      provider: 'openai',
      model: 'gpt-4o-mini',
      creds: {},
    } as any)

    expect(browser.getTools()).not.toHaveProperty('stagehand_close')
    expect(wrapStagehandTools(browser)).not.toHaveProperty('stagehand_close')
  })
})
