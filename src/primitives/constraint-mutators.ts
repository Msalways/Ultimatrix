/**
 * constraint-mutators — pure, typed relation-seeded mutation generator.
 *
 * Given a relation discovered in the graph (e.g. a value from endpoint A's
 * response re-ingested into endpoint B's request), generate concrete request
 * mutations that attempt to VIOLATE the implied constraint. Value treatment is
 * derived from STRUCTURAL SHAPE (numeric / uuid / enum), never from a keyword
 * list of field names. The LLM decides which mutation to actually run.
 */

export type ValueShape = 'numeric' | 'uuid' | 'enum' | 'unknown'

export interface RelationSeed {
  relationType: 'REINGESTS' | 'VALUE_ORIGIN' | 'ORDERED_BEFORE'
  /** The captured value that flows from source to sink. */
  sourceValue: string
  /** The sink parameter/header name that receives it. */
  sinkParam: string
  /** Where the value originates (response-field / cookie / header / ui-input). */
  sourceKind: string
}

export interface Mutation {
  kind: 'foreign' | 'boundary' | 'omit' | 'out-of-order'
  param: string
  value: string
  note: string
}

/** Structural shape of a captured value — shape only, no name inspection. */
export function shapeOf(value: string): ValueShape {
  const v = value.trim()
  if (/^\d+$/.test(v)) return 'numeric'
  if (/^[0-9a-f-]{16,}$/i.test(v) || /^[0-9a-f]{8,}$/i.test(v)) return 'uuid'
  if (v.length > 0 && v.length <= 64 && /^[A-Za-z0-9_.-]+$/.test(v)) return 'enum'
  return 'unknown'
}

const FOREIGN_NUMERIC = [1, 2, 999999, 0]
const FOREIGN_UUID = ['00000000-0000-0000-0000-000000000001', 'ffffffff-ffff-ffff-ffff-ffffffffffff']
const FOREIGN_ENUM = ['other', 'foreign', 'attacker', 'victim']

/**
 * Build the set of relation-seeded mutations for a single seed. The baseline is
 * the real captured request (handled by the caller); these are the violations.
 */
export function mutationsFor(seed: RelationSeed): Mutation[] {
  const shape = shapeOf(seed.sourceValue)
  const out: Mutation[] = []

  // Always offer to omit the field (mass-assignment / required-field probe).
  out.push({ kind: 'omit', param: seed.sinkParam, value: '', note: `omit ${seed.sinkParam} to test whether the server re-derives it` })

  if (shape === 'numeric') {
    for (const n of FOREIGN_NUMERIC) {
      if (String(n) === seed.sourceValue) continue
      out.push({ kind: 'foreign', param: seed.sinkParam, value: String(n), note: `foreign numeric id (was ${seed.sourceValue})` })
    }
  } else if (shape === 'uuid') {
    for (const u of FOREIGN_UUID) {
      if (u === seed.sourceValue) continue
      out.push({ kind: 'foreign', param: seed.sinkParam, value: u, note: `foreign uuid (was ${seed.sourceValue.slice(0, 8)}…)` })
    }
  } else {
    for (const e of FOREIGN_ENUM) {
      if (e === seed.sourceValue) continue
      out.push({ kind: 'foreign', param: seed.sinkParam, value: e, note: `foreign value (was ${seed.sourceValue.slice(0, 16)})` })
    }
  }

  return out
}
