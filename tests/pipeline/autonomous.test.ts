import { describe, it, expect, vi } from 'vitest';

describe('AutonomousOrchestrator', () => {
  it('should export AutonomousOrchestrator class', async () => {
    const mod = await import('../../src/pipeline/autonomous');
    expect(mod.AutonomousOrchestrator).toBeDefined();
  });

  it('STRATEGIST_PROMPT should guide strategist behavior', async () => {
    const mod = await import('../../src/prompts/threat-model');
    expect(mod.STRATEGIST_PROMPT).toBeDefined();
    expect(typeof mod.STRATEGIST_PROMPT).toBe('string');
    expect(mod.STRATEGIST_PROMPT).toContain('security strategist');
    expect(mod.STRATEGIST_PROMPT).toContain('spawn_agent');
    expect(mod.STRATEGIST_PROMPT).toContain('techniques');
    expect(mod.STRATEGIST_PROMPT).toContain('FIRE-AND-FORGET');
  });

  it('AutonomousOrchestrator should construct with model, target, outputDir', async () => {
    const mod = await import('../../src/pipeline/autonomous');
    const mockModel = {} as any;
    const orchestrator = new mod.AutonomousOrchestrator({
      model: mockModel,
      target: 'https://example.com',
      outputDir: '/tmp/test',
    });
    expect(orchestrator).toBeDefined();
    expect(orchestrator.run).toBeDefined();
    expect(typeof orchestrator.run).toBe('function');
  });

  it('trackInFlightWorker + waitForInFlightWorkers awaits worker promises', async () => {
    const mod = await import('../../src/pipeline/autonomous');
    const mockModel = {} as any;
    const orchestrator = new mod.AutonomousOrchestrator({
      model: mockModel,
      target: 'https://example.com',
      outputDir: '/tmp/test',
    });
    let resolveWorker: () => void = () => {};
    const workerPromise = new Promise<void>((r) => { resolveWorker = r; });
    (orchestrator as any).trackInFlightWorker('test-worker', workerPromise);
    const waitStart = Date.now();
    setTimeout(() => resolveWorker(), 50);
    await (orchestrator as any).waitForInFlightWorkers();
    const waitMs = Date.now() - waitStart;
    expect(waitMs).toBeLessThan(2000);
    expect((orchestrator as any).inFlightWorkers.size).toBe(0);
  });
});
