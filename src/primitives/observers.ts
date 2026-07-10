/**
 * Thin wrappers around the generic observation oracles (src/tools/observation-tools.ts).
 * Primitives reuse these rather than reimplementing response analysis.
 */

import { parseResponse, compareResponses, checkWaf, findEndpointsInResponse } from '../tools/observation-tools'

export interface ParsedResponse {
  ok: boolean
  value: {
    status: number
    body: string
    headers: Record<string, string>
    json: unknown
    dom: string
    textSnippets: string[]
  }
}

export async function observeParse(
  body: string,
  headers: Record<string, string>,
  status: number,
): Promise<ParsedResponse['value']> {
  const r = (await (parseResponse as any).execute({ body, headers, status })) as ParsedResponse
  return r.value
}

export interface CompareValue {
  divergence: number
  vulnerable: boolean
  baselineBytes: number
  targetBytes: number
}

export async function observeCompare(
  baseline: { body: string; status: number },
  target: { body: string; status: number },
  ignoreKeys?: string[],
): Promise<CompareValue> {
  const r: any = await (compareResponses as any).execute({ baseline, target, ignoreKeys })
  return r.value
}

export interface WafValue {
  detected: boolean
  vendor: string
  confidence: number
}

export async function observeWaf(
  responseHeaders: Record<string, string>,
  responseBody: string,
): Promise<WafValue> {
  const r: any = await (checkWaf as any).execute({ responseHeaders, responseBody })
  return r.value
}

export async function observeEndpoints(html: string, baseUrl: string): Promise<string[]> {
  const r: any = await (findEndpointsInResponse as any).execute({ html, baseUrl })
  return r.value
}
