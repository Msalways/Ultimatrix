// src/cli/setup.ts
//
// `ultimatrix setup` — interactive + scripted configuration of LLM
// providers. Writes either:
//   - ~/.config/ultimatrix/providers.yaml   (global, default, secrets here)
//   - ./ultimatrix.yaml                      (project, NO secrets by default)
//
// The function writeProviderEntry() is the pure side-effect: takes a path
// + entry, merges with any existing file, writes the YAML back. It is
// exported so the unit tests can exercise the merge + chmod + id-sort logic
// without spawning the interactive prompts (which use @inquirer/prompts
// and require a TTY).

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import yaml from 'js-yaml';

export interface ProviderEntry {
  /** API key for the provider (only in global file) */
  apiKey?: string;
  /** Default model id (e.g. "openai/gpt-oss-120b") */
  model?: string;
  /** Override base URL (OpenAI-compatible providers) */
  baseUrl?: string;
  /** Provider-specific extra fields (e.g. Azure endpoint) */
  [extra: string]: string | undefined;
}

export type ProvidersFile = Record<string, ProviderEntry>;

/**
 * Default location of the global secrets file.
 * `~/.config/ultimatrix/providers.yaml` on all platforms.
 */
export function globalProvidersPath(): string {
  return path.join(os.homedir(), '.config', 'ultimatrix', 'providers.yaml');
}

/**
 * Read the global providers file, returning an empty object if missing or
 * malformed. Never throws — corrupted files are treated as empty so the
 * next write can recover.
 */
export function readProvidersFile(filePath: string): ProvidersFile {
  if (!fs.existsSync(filePath)) return {};
  try {
    const raw = fs.readFileSync(filePath, 'utf-8');
    if (!raw.trim()) return {};
    const parsed = yaml.load(raw) as unknown;
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as ProvidersFile;
    }
    return {};
  } catch {
    return {};
  }
}

/**
 * Merge `entry` into the existing providers file under `providerName`,
 * then write back. Existing entries for other providers are preserved.
 * On POSIX, chmod 0600 (owner read/write only) — secrets shouldn't leak
 * to other users on a shared host. On Windows, chmod is a no-op.
 */
export function writeProviderEntry(
  providersPath: string,
  providerName: string,
  entry: ProviderEntry,
): { written: number; merged: ProvidersFile } {
  fs.mkdirSync(path.dirname(providersPath), { recursive: true });
  const existing = readProvidersFile(providersPath);
  // Shallow-merge per provider — new fields win, but the user's other
  // providers stay intact if they re-run setup for a different one.
  const merged: ProvidersFile = { ...existing, [providerName]: { ...existing[providerName], ...entry } };
  fs.writeFileSync(providersPath, yaml.dump(merged, { lineWidth: 120 }), 'utf-8');
  try { fs.chmodSync(providersPath, 0o600); } catch { /* Windows or non-POSIX FS */ }
  return { written: Object.keys(merged).length, merged };
}

/**
 * Write or update the top-level `provider:` block in a project's
 * `ultimatrix.yaml`. Unlike the global file, this is intended to be
 * committed (the user is expected to scrub secrets before pushing).
 */
export function writeProjectProvider(
  yamlPath: string,
  providerName: string,
  entry: ProviderEntry,
): void {
  let existing: Record<string, unknown> = {};
  if (fs.existsSync(yamlPath)) {
    try {
      const raw = fs.readFileSync(yamlPath, 'utf-8');
      const parsed = raw.trim() ? (yaml.load(raw) as unknown) : null;
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        existing = parsed as Record<string, unknown>;
      }
    } catch { /* ignore — start fresh */ }
  }
  existing.provider = { name: providerName, ...entry };
  fs.writeFileSync(yamlPath, yaml.dump(existing, { lineWidth: 120 }), 'utf-8');
}

/** Strip undefined fields so YAML doesn't emit `key: null` lines. */
export function cleanEntry(entry: ProviderEntry): ProviderEntry {
  const out: ProviderEntry = {};
  for (const [k, v] of Object.entries(entry)) {
    if (typeof v === 'string' && v.length > 0) out[k] = v;
  }
  return out;
}
