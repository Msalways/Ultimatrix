import type { PrimitiveContext, PrimitiveResult } from '../primitives/types';
import type { Plugin } from './types';
import { getGlobalRegistry } from './registry';

let recordingDepth = 0;

export function createRecordingPlugin(): Plugin {
  return {
    name: 'recording',
    version: '1.0.0',
    description: 'Auto-generates Playwright test steps from primitive calls that declare toPlaywrightStep metadata',
    primitives: {},
    hooks: {
      afterPrimitive: async (name: string, _args: unknown, result: PrimitiveResult, ctx: PrimitiveContext) => {
        if (!result.ok || !ctx.liveSpec) return;
        if (name === 'recordTestStep') return;
        if (recordingDepth > 0) return;

        const def = getGlobalRegistry().getPrimitive(name);
        if (!def || !def.toPlaywrightStep) return;

        recordingDepth++;
        try {
          const step = def.toPlaywrightStep(_args, result);
          if (!step) return;
          const { recordTestStep } = await import('../primitives/control');
          await Promise.resolve(
            recordTestStep.execute(
              { description: step.description, action: step.action, assertion: step.assertion },
              ctx,
            ),
          );
        } catch {
          // never let recording break execution
        } finally {
          recordingDepth--;
        }
      },
    },
  };
}
