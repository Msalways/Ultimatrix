// src/cli/doctor.ts
//
// `ultimatrix doctor` — checks the local environment and reports
// what's working, what's missing, and what to fix. Used as a first
// step when a hunt is misbehaving.

import { existsSync, statSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { getDefaultLLMClient } from '../llm/client';

export interface DoctorCheck {
  name: string;
  ok: boolean;
  detail: string;
  fix?: string;
}

export interface DoctorReport {
  ok: boolean;
  checks: DoctorCheck[];
  warnings: string[];
}

function tryExec(cmd: string): string | null {
  try {
    return execSync(cmd, { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
  } catch {
    return null;
  }
}

export async function runDoctor(): Promise<DoctorReport> {
  const checks: DoctorCheck[] = [];
  const warnings: string[] = [];

  // 1. Node version
  const nodeV = process.version;
  const major = parseInt(nodeV.replace(/^v/, '').split('.')[0], 10);
  checks.push({
    name: 'Node.js',
    ok: major >= 20,
    detail: `${nodeV} (need >= 20)`,
    fix: major < 20 ? 'Install Node 20+: nvm install 20 && nvm use 20' : undefined,
  });

  // 2. Playwright (for browser-driven primitives)
  let pwOk = false;
  let pwDetail = 'not installed';
  try {
    const pwVer = tryExec('npx playwright --version');
    if (pwVer) {
      pwOk = true;
      pwDetail = pwVer;
    }
  } catch { /* ignore */ }
  checks.push({
    name: 'Playwright',
    ok: pwOk,
    detail: pwDetail,
    fix: pwOk ? undefined : 'npm install -D @playwright/test && npx playwright install',
  });

  // 3. LLM provider
  let llmDetail = 'no provider detected';
  let llmOk = false;
  try {
    const llm = getDefaultLLMClient();
    const provider = (llm as unknown as { getProviderName?: () => string }).getProviderName?.() ?? 'unknown';
    const model = (llm as unknown as { getModelName?: () => string }).getModelName?.() ?? 'unknown';
    llmDetail = `${provider} (${model})`;
    llmOk = true;
  } catch (err) {
    llmDetail = `error: ${(err as Error).message}`;
  }
  checks.push({
    name: 'LLM provider',
    ok: llmOk,
    detail: llmDetail,
    fix: llmOk ? undefined : 'Configure ultimatrix.yaml or set GROQ_API_KEY / OPENAI_API_KEY etc.',
  });

  // 4. Network reachability of xss-game (used for demo)
  const xss = tryFetch('https://xss-game.appspot.com/');
  // Network errors and unreachable targets are warnings, not failures.
  // We don't want a flaky demo server to block `doctor`.
  checks.push({
    name: 'xss-game reachable (demo target)',
    ok: xss === true,
    detail: xss === true ? '200 OK' : (xss === null ? 'curl not available or network error' : 'unreachable'),
  });
  if (xss === null) warnings.push('Could not run curl — install curl or check PATH to enable network reachability checks.');
  if (xss === false) warnings.push('xss-game.appspot.com not reachable from this host; the `demo` subcommand may fail.');

  // 5. ~/.config/ultimatrix/ providers.yaml
  const providersPath = join(homedir(), '.config', 'ultimatrix', 'providers.yaml');
  checks.push({
    name: 'Global providers.yaml',
    ok: existsSync(providersPath),
    detail: existsSync(providersPath) ? providersPath : 'not found (using env vars)',
    fix: existsSync(providersPath) ? undefined : 'mkdir ~/.config/ultimatrix && write providers.yaml with apiKey',
  });

  // 6. ultimatrix.yaml in cwd
  const localYaml = join(process.cwd(), 'ultimatrix.yaml');
  const localYml = join(process.cwd(), 'ultimatrix.yml');
  const localExists = existsSync(localYaml) || existsSync(localYml);
  checks.push({
    name: 'Project ultimatrix.yaml',
    ok: true,  // not required
    detail: localExists ? 'present' : 'not present (using global config or env)',
  });

  // 7. Output dir writable
  let writeOk = false;
  let writeDetail = 'cannot write to ./output';
  try {
    const testPath = join(process.cwd(), 'output', '.doctor-test');
    if (!existsSync(join(process.cwd(), 'output'))) {
      require('node:fs').mkdirSync(join(process.cwd(), 'output'), { recursive: true });
    }
    require('node:fs').writeFileSync(testPath, 'x');
    require('node:fs').unlinkSync(testPath);
    writeOk = true;
    writeDetail = './output writable';
  } catch (err) {
    writeDetail = `error: ${(err as Error).message}`;
  }
  checks.push({
    name: 'Output dir',
    ok: writeOk,
    detail: writeDetail,
    fix: writeOk ? undefined : 'Ensure ./output exists and is writable',
  });

  // Warnings
  if (!pwOk) warnings.push('Browser-driven primitives will fail without Playwright. Install before running hunts.');
  if (!llmOk) warnings.push('No LLM provider detected. Hunts will fall back to mock LLM and produce no real findings.');

  const ok = checks.every((c) => c.ok);
  return { ok, checks, warnings };
}

function tryFetch(url: string): boolean | null {
  try {
    const out = execSync(`curl -s -o /dev/null -w "%{http_code}" --max-time 5 ${url}`, { stdio: ['ignore', 'pipe', 'ignore'] }).toString();
    const code = parseInt(out, 10);
    if (code === 200) return true;
    if (code === 0) return null;
    return false;
  } catch {
    return null;
  }
}
