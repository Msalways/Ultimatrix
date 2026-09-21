import { describe, expect, it } from 'vitest'
import { DEFAULTS } from '../../src/config'
import { deriveStagehandModel, getOrCreateBrowser } from '../../src/browser/manager'
import { wrapStagehandTools } from '../../src/browser/dialog-inject'

describe('shared browser manager', () => {
  it('maps OpenAI-compatible providers to a Stagehand-supported adapter', () => {
    const model = deriveStagehandModel({
      ...DEFAULTS,
      provider: 'nvidia',
      model: 'nvidia/nemotron-3-super-120b-a12b',
      creds: { nvidia: { apiKey: 'nv-key', baseUrl: 'https://integrate.api.nvidia.com/v1' } },
    } as any)

    expect(model.modelName).toBe('openai/nvidia/nemotron-3-super-120b-a12b')
    expect(model.apiKey).toBe('nv-key')
    expect(model.baseURL).toBe('https://integrate.api.nvidia.com/v1')
  })

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
