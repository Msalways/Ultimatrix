// tests/codegen/finalize.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, existsSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { finalizeLiveSpec } from '../../src/codegen/finalize';

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'codegen-'));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('finalizeLiveSpec', () => {
  it('throws when live spec does not exist', () => {
    expect(() => finalizeLiveSpec({ liveSpecPath: join(dir, 'missing.spec.ts') })).toThrow(/not found/);
  });

  it('writes a finalised spec to outDir', () => {
    const live = join(dir, 'live.spec.ts');
    writeFileSync(live, "// live spec content\nexport default {};\n");
    const out = finalizeLiveSpec({ liveSpecPath: live, outDir: dir });
    expect(existsSync(out)).toBe(true);
    const content = readFileSync(out, 'utf8');
    expect(content).toMatch(/FINALISED/);
    expect(content).toMatch(/live spec content/);
  });

  it('writes a sibling README', () => {
    const live = join(dir, 'live.spec.ts');
    writeFileSync(live, 'export default {};\n');
    finalizeLiveSpec({ liveSpecPath: live, outDir: dir });
    expect(existsSync(join(dir, 'README.md'))).toBe(true);
    const readme = readFileSync(join(dir, 'README.md'), 'utf8');
    expect(readme).toMatch(/Run/);
    expect(readme).toMatch(/playwright/);
  });

  it('creates outDir if missing', () => {
    const live = join(dir, 'live.spec.ts');
    writeFileSync(live, 'export default {};\n');
    const nested = join(dir, 'sub', 'dir');
    const out = finalizeLiveSpec({ liveSpecPath: live, outDir: nested });
    expect(existsSync(out)).toBe(true);
  });

  it('strips .spec.ts from finalised filename', () => {
    const live = join(dir, 'live.spec.ts');
    writeFileSync(live, 'export default {};\n');
    const out = finalizeLiveSpec({ liveSpecPath: live, outDir: dir });
    expect(out).toMatch(/live\.finalised\.spec\.ts$/);
  });
});
