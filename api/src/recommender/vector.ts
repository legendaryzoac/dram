// Pure vector math + structured feature-vectorization for the recommender's
// layer 1. No AWS, no I/O — everything here is unit-tested in vector.test.ts.

import { FLAVOR_AXES, type FlavorTags } from '../types'

/** Cosine similarity of two equal-length vectors, in [-1, 1]. */
export function cosine(a: number[], b: number[]): number {
  if (a.length !== b.length) {
    throw new Error(`cosine: length mismatch ${a.length} vs ${b.length}`)
  }
  let dot = 0
  let na = 0
  let nb = 0
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i]
    na += a[i] * a[i]
    nb += b[i] * b[i]
  }
  // A zero-magnitude vector has no direction; define similarity as 0 rather
  // than NaN so it sorts to the bottom instead of poisoning the ranking.
  if (na === 0 || nb === 0) return 0
  return dot / (Math.sqrt(na) * Math.sqrt(nb))
}

/** Map cosine's [-1, 1] into the contract's [0, 1] score space. */
export function toScore(cos: number): number {
  const s = (cos + 1) / 2
  return s < 0 ? 0 : s > 1 ? 1 : s
}

/** Mean of a set of equal-length vectors. Returns null for an empty set. */
export function meanVector(vectors: number[][]): number[] | null {
  if (vectors.length === 0) return null
  const dim = vectors[0].length
  const out = new Array<number>(dim).fill(0)
  for (const v of vectors) {
    if (v.length !== dim) {
      throw new Error('meanVector: ragged input')
    }
    for (let i = 0; i < dim; i++) out[i] += v[i]
  }
  for (let i = 0; i < dim; i++) out[i] /= vectors.length
  return out
}

/**
 * A bottle as seen by the structured layer: its categorical metadata, its
 * aggregate flavor profile (may be absent if it has no notes, and may be
 * missing axes no note has measured), and abv.
 */
export interface StructuredBottle {
  id: string
  region: string
  type: string
  abv: number
  flavorProfile: Partial<FlavorTags> | null
}

/**
 * The categorical vocabularies are derived from the corpus itself so the
 * one-hot dimensions line up across every bottle in a single ranking call.
 */
export interface Vocab {
  regions: string[]
  types: string[]
}

export function buildVocab(bottles: StructuredBottle[]): Vocab {
  const regions = new Set<string>()
  const types = new Set<string>()
  for (const b of bottles) {
    regions.add(b.region)
    types.add(b.type)
  }
  return {
    // Sorted for determinism, so the same corpus always yields the same layout.
    regions: [...regions].sort(),
    types: [...types].sort(),
  }
}

function oneHot(value: string, vocab: string[]): number[] {
  return vocab.map((v) => (v === value ? 1 : 0))
}

// ABV realistically spans 0 (coffee) to ~90 (historic-strength absinthe);
// scale into ~[0,1] so it contributes on the same order as the one-hot and
// flavor dims rather than dominating them.
const ABV_SCALE = 90

// Flavor axes are 0..5; divide so each lands in [0,1].
const FLAVOR_SCALE = 5

/**
 * Feature-vector a bottle: [regions one-hot | types one-hot | 8 flavor dims |
 * abv]. Bottles with no flavor profile get a neutral mid-scale flavor block so
 * they still rank on region/type/abv rather than being pushed to an extreme;
 * an axis missing from a partial profile (no note measured it) gets the same
 * neutral value rather than a false zero.
 */
export function vectorize(bottle: StructuredBottle, vocab: Vocab): number[] {
  const flavor = FLAVOR_AXES.map((axis) => {
    const v = bottle.flavorProfile?.[axis]
    return v === undefined ? 0.5 : v / FLAVOR_SCALE
  })
  return [
    ...oneHot(bottle.region, vocab.regions),
    ...oneHot(bottle.type, vocab.types),
    ...flavor,
    bottle.abv / ABV_SCALE,
  ]
}

export interface Ranked {
  id: string
  score: number
}

/**
 * Rank `candidates` by cosine similarity to a target vector, descending.
 * Ties break by id (ascending) for stable, deterministic output.
 */
export function rankBySimilarity(
  target: number[],
  candidates: Array<{ id: string; vector: number[] }>,
): Ranked[] {
  return candidates
    .map(({ id, vector }) => ({ id, score: toScore(cosine(target, vector)) }))
    .sort((x, y) => y.score - x.score || (x.id < y.id ? -1 : x.id > y.id ? 1 : 0))
}
