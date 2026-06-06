// src/oast/singleton.ts
//
// Singleton holder for the OastServer. The hunt pipeline shares one
// OAST server across the whole run, so it can be polled and stopped
// from anywhere in the codebase. Persists callbacks to disk so a
// crash doesn't lose evidence.

import { OastServer } from './server';

let _oast: OastServer | null = null;

export async function ensureOastRunning(persistencePath?: string): Promise<number> {
  if (_oast && _oast.isRunning()) return _oast.getPort();
  _oast = new OastServer(0, persistencePath);
  return _oast.start();
}

export function getOastServer(): OastServer {
  if (!_oast) throw new Error('OAST server not running. Call ensureOastRunning() first.');
  return _oast;
}

export function stopOast(): void {
  if (_oast) {
    _oast.stop();
    _oast = null;
  }
}

/** Test-only: reset the singleton. */
export function _resetOastSingleton(): void {
  if (_oast) _oast.stop();
  _oast = null;
}
