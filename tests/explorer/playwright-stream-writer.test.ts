import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { StreamWriter, streamPlaywrightDoc, type StreamedEvent } from '../../src/explorer/playwright-stream-writer';
import * as fsp from 'node:fs';
import * as pth from 'node:path';
import * as os from 'node:os';

describe('StreamWriter', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fsp.mkdtempSync(pth.join(os.tmpdir(), 'pw-streamer-'));
  });

  afterEach(() => {
    try { fsp.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* ignore */ }
  });

  it('creates file with header on first push', async () => {
    const writer = new StreamWriter({ outputDir: tmpDir, target: 'https://example.com' });
    await writer.push({ kind: 'navigate', url: 'https://example.com' });
    const content = fsp.readFileSync(writer.path, 'utf-8');
    expect(content).toContain('import { test, expect }');
    expect(content).toContain('Ultimatrix Swarm Replay');
    expect(content).toContain('await page.goto(\'https://example.com\')');
    await writer.close();
  });

  it('appends events in order', async () => {
    const writer = new StreamWriter({ outputDir: tmpDir, target: 'https://example.com' });
    await writer.push({ kind: 'navigate', url: 'https://example.com/' });
    await writer.push({ kind: 'click', selector: '#login' });
    await writer.push({ kind: 'fill', selector: '#email', value: 'test@example.com' });
    const content = fsp.readFileSync(writer.path, 'utf-8');
    const navPos = content.indexOf("page.goto('https://example.com/')");
    const clickPos = content.indexOf("page.click('#login')");
    const fillPos = content.indexOf("page.fill('#email'");
    expect(navPos).toBeGreaterThan(-1);
    expect(clickPos).toBeGreaterThan(navPos);
    expect(fillPos).toBeGreaterThan(clickPos);
    await writer.close();
  });

  it('masks sensitive values', async () => {
    const writer = new StreamWriter({ outputDir: tmpDir, target: 'https://example.com' });
    await writer.push({ kind: 'fill', selector: '#password', value: 'supersecret123' });
    const content = fsp.readFileSync(writer.path, 'utf-8');
    expect(content).toContain('••••••••');
    expect(content).not.toContain('supersecret123');
    await writer.close();
  });

  it('renders http_request with evidence and vulnerability marker', async () => {
    const writer = new StreamWriter({ outputDir: tmpDir, target: 'https://example.com' });
    await writer.push({
      kind: 'http_request',
      method: 'POST',
      url: 'https://example.com/api/login',
      payload: "admin' --",
      status: 500,
      evidence: ['SQL syntax error', 'MySQL server version'],
      vulnerable: true,
    });
    const content = fsp.readFileSync(writer.path, 'utf-8');
    expect(content).toContain('[VULNERABLE]');
    expect(content).toContain('SQL syntax error');
    expect(content).toContain('MySQL server version');
    await writer.close();
  });

  it('renders decision comments', async () => {
    const writer = new StreamWriter({ outputDir: tmpDir, target: 'https://example.com' });
    await writer.push({ kind: 'comment', text: 'Strategist dispatched IDOR specialist because target has numeric ID parameter' });
    const content = fsp.readFileSync(writer.path, 'utf-8');
    expect(content).toContain('// Strategist dispatched IDOR specialist');
    await writer.close();
  });

  it('renders specialist dispatch event', async () => {
    const writer = new StreamWriter({ outputDir: tmpDir, target: 'https://example.com' });
    await writer.push({ kind: 'specialist_dispatch', specialist: 'jwt-specialist', technique: 'auth-bypass', endpoint: '/api/users' });
    const content = fsp.readFileSync(writer.path, 'utf-8');
    expect(content).toContain('jwt-specialist');
    expect(content).toContain('auth-bypass');
    await writer.close();
  });

  it('renders finding events with vulnerability label', async () => {
    const writer = new StreamWriter({ outputDir: tmpDir, target: 'https://example.com' });
    await writer.push({ kind: 'finding', technique: 'XSS', endpoint: '/search', vulnerable: true, confidence: 0.9 });
    const content = fsp.readFileSync(writer.path, 'utf-8');
    expect(content).toContain('Finding: XSS');
    expect(content).toContain('VULNERABLE');
    expect(content).toContain('90%');
    await writer.close();
  });

  it('queues concurrent pushes and preserves order', async () => {
    const writer = new StreamWriter({ outputDir: tmpDir, target: 'https://example.com' });
    const promises: Promise<void>[] = [];
    for (let i = 0; i < 20; i++) {
      promises.push(writer.push({ kind: 'click', selector: `#btn-${i}` }));
    }
    await Promise.all(promises);
    const content = fsp.readFileSync(writer.path, 'utf-8');
    let lastPos = -1;
    let inOrder = true;
    for (let i = 0; i < 20; i++) {
      const pos = content.indexOf(`#btn-${i}`);
      if (pos <= lastPos) { inOrder = false; break; }
      lastPos = pos;
    }
    expect(inOrder).toBe(true);
    await writer.close();
  });

  it('close appends footer with describe closure', async () => {
    const writer = new StreamWriter({ outputDir: tmpDir, target: 'https://example.com' });
    await writer.push({ kind: 'navigate', url: 'https://example.com' });
    await writer.close();
    const content = fsp.readFileSync(writer.path, 'utf-8');
    expect(content.trim().endsWith('});')).toBe(true);
  });

  it('rejects push after close', async () => {
    const writer = new StreamWriter({ outputDir: tmpDir, target: 'https://example.com' });
    await writer.push({ kind: 'navigate', url: 'https://example.com' });
    await writer.close();
    await expect(writer.push({ kind: 'navigate', url: 'https://example.com' })).rejects.toThrow('already closed');
  });

  it('streamPlaywrightDoc returns a streamer with filePath', async () => {
    const streamer = await streamPlaywrightDoc({ outputDir: tmpDir, target: 'https://example.com' });
    expect(streamer.filePath).toContain('replay.spec.ts');
    expect(streamer.pending).toBe(0);
    await streamer.push({ kind: 'navigate', url: 'https://example.com' });
    const out = await streamer.close();
    expect(out).toContain('replay.spec.ts');
    expect(fsp.existsSync(out)).toBe(true);
  });

  it('handles special characters in values', async () => {
    const writer = new StreamWriter({ outputDir: tmpDir, target: 'https://example.com' });
    await writer.push({ kind: 'fill', selector: '#msg', value: "it's a `test`" });
    const content = fsp.readFileSync(writer.path, 'utf-8');
    expect(content).toContain("\\'");
    expect(content).toContain("\\`");
    await writer.close();
  });

  it('truncates long values', async () => {
    const writer = new StreamWriter({ outputDir: tmpDir, target: 'https://example.com' });
    const longValue = 'A'.repeat(1000);
    await writer.push({ kind: 'fill', selector: '#msg', value: longValue });
    const content = fsp.readFileSync(writer.path, 'utf-8');
    const valueInContent = content.match(/await page\.fill\('[^']+', '([^']*)'\)/);
    expect(valueInContent).toBeTruthy();
    expect(valueInContent![1].length).toBeLessThanOrEqual(200);
    await writer.close();
  });
});
