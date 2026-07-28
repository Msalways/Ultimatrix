'use client'

import { useConfigStore } from '@/stores/config-store'
import { ConfigField } from '../config-field'
import { ConfigSelect } from '../config-select'
import { ConfigToggle } from '../config-toggle'
import { ConfigNumber } from '../config-number'
import { ConfigSection } from '../config-section'

export function BrowserTab() {
  const config = useConfigStore((s) => s.config)
  const update = useConfigStore((s) => s.update)

  if (!config) return null

  const browser = config.browser || { headless: true, viewport: { width: 1280, height: 720 }, domSettleTimeout: 5000, env: 'LOCAL', selfHeal: true, verbose: 0 }
  const spider = config.spider || {}
  const vp = browser.viewport || { width: 1280, height: 720 }

  const updateViewport = (field: 'width' | 'height', value: number) => {
    update({ browser: { ...browser, viewport: { ...vp, [field]: value } } })
  }

  return (
    <div className="space-y-6">
      <ConfigSection title="Browser" defaultOpen={true}>
        <div className="space-y-3">
          <ConfigToggle
            checked={browser.headless}
            onChange={(v) => update({ browser: { ...browser, headless: v } })}
            label="Headless mode"
          />

          <div className="grid grid-cols-2 gap-4">
            <ConfigField label="Viewport Width">
              <ConfigNumber
                value={vp.width ?? 1280}
                onChange={(v) => updateViewport('width', v)}
                min={640}
                max={3840}
              />
            </ConfigField>
            <ConfigField label="Viewport Height">
              <ConfigNumber
                value={vp.height ?? 720}
                onChange={(v) => updateViewport('height', v)}
                min={480}
                max={2160}
              />
            </ConfigField>
          </div>

          <ConfigField label="DOM Settle Timeout (ms)">
            <ConfigNumber
              value={browser.domSettleTimeout ?? 5000}
              onChange={(v) => update({ browser: { ...browser, domSettleTimeout: v } })}
              min={500}
              step={500}
            />
          </ConfigField>

          <ConfigField label="Environment">
            <ConfigSelect
              value={browser.env || 'LOCAL'}
              onChange={(v) => update({ browser: { ...browser, env: v } })}
              options={[
                { value: 'LOCAL', label: 'Local' },
                { value: 'CI', label: 'CI' },
                { value: 'STAGING', label: 'Staging' },
              ]}
            />
          </ConfigField>

          <ConfigToggle
            checked={browser.selfHeal}
            onChange={(v) => update({ browser: { ...browser, selfHeal: v } })}
            label="Self-heal selectors"
          />

          <ConfigField label="Verbosity (0-3)">
            <ConfigNumber
              value={browser.verbose ?? 0}
              onChange={(v) => update({ browser: { ...browser, verbose: v } })}
              min={0}
              max={3}
            />
          </ConfigField>
        </div>
      </ConfigSection>

      <ConfigSection title="Spider">
        <div className="space-y-3">
          <ConfigToggle
            checked={spider.enabled ?? false}
            onChange={(v) => update({ spider: { ...spider, enabled: v } })}
            label="Enable spider"
          />

          {spider.enabled && (
            <>
              <ConfigField label="Max Steps">
                <ConfigNumber
                  value={spider.maxSteps ?? 50}
                  onChange={(v) => update({ spider: { ...spider, maxSteps: v } })}
                  min={1}
                />
              </ConfigField>
              <ConfigField label="Max Duration (ms)">
                <ConfigNumber
                  value={spider.maxDurationMs ?? 120000}
                  onChange={(v) => update({ spider: { ...spider, maxDurationMs: v } })}
                  min={10000}
                  step={10000}
                />
              </ConfigField>
            </>
          )}
        </div>
      </ConfigSection>
    </div>
  )
}
