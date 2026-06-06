// src/oast/wrapper.ts
//
// withOobCallback is the OOB-aware request wrapper. It:
//   1. Reserves a UUID + URL on the OastServer
//   2. Replaces the {host}/{uuid} placeholder in the supplied payload
//   3. Sends the request
//   4. Polls the OastServer for callbacks
//   5. Emits a HuntEvent if a callback fires
//   6. Returns the result + matched probe

import type { OastServer, CallbackRecord } from './server';
import type { OOBCategory, OOBProbe } from './categories';
import { OOB_TEMPLATES } from './categories';
import type { HuntCore } from '../hunt/core';

export interface WithOobOptions {
  oast: OastServer;
  core: HuntCore;
  category: OOBCategory;
  /** The original payload to inject. Use the placeholder {host}/{uuid} where the OOB URL goes. */
  payloadTemplate: string;
  endpoint: string;
  param: string;
  /** Send the request. */
  send: (mutatedPayload: string) => Promise<{ status: number; body: string }>;
  /** How long to poll for callbacks (ms). Default 8000. */
  pollMs?: number;
  /** Poll interval (ms). Default 500. */
  pollIntervalMs?: number;
  /** Optional host override (default: oast port). */
  hostOverride?: string;
}

export interface WithOobResult {
  uuid: string;
  oobUrl: string;
  mutatedPayload: string;
  requestResult: { status: number; body: string };
  callback: CallbackRecord | null;
  probed: OOBProbe;
}

export async function withOobCallback(opts: WithOobOptions): Promise<WithOobResult> {
  const { uuid, url } = opts.oast.createUrl();
  const host = opts.hostOverride ?? `127.0.0.1:${opts.oast.getPort()}`;
  const mutated = opts.payloadTemplate
    .replace('{host}', host)
    .replace('{uuid}', uuid);
  const probed: OOBProbe = {
    uuid,
    url,
    category: opts.category,
    endpoint: opts.endpoint,
    param: opts.param,
    payload: mutated,
    registeredAt: Date.now(),
  };
  const requestResult = await opts.send(mutated);
  // Poll for callbacks
  const pollMs = opts.pollMs ?? 8000;
  const pollIntervalMs = opts.pollIntervalMs ?? 500;
  const deadline = Date.now() + pollMs;
  let callback: CallbackRecord | null = null;
  while (Date.now() < deadline) {
    const records = opts.oast.checkCallbacks(uuid);
    if (records.length > 0) {
      callback = records[0];
      break;
    }
    await new Promise((r) => setTimeout(r, pollIntervalMs));
  }
  if (callback) {
    opts.core.recordOOB({
      url: callback.url,
      source: opts.category,
      bodyPreview: callback.body,
      headers: callback.headers,
      receivedAt: callback.timestamp,
    });
  }
  return { uuid, oobUrl: url, mutatedPayload: mutated, requestResult, callback, probed };
}

/** Build a payload for a given OOB category. */
export function buildOobPayload(category: OOBCategory, host: string, uuid: string): string {
  const tmpl = OOB_TEMPLATES[category][0];
  return tmpl.replace('{host}', host).replace('{uuid}', uuid);
}
