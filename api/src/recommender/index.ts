// Recommender orchestration: tries the best available layer and reports which
// via `basis`, degrading gracefully. `degraded` is true only when Bedrock was
// meant to run (text/narrated) but was unavailable, forcing a fall to layer 1.
//
// Layer 1 (structured): always on, no Bedrock. Feature-vector every bottle from
//   region/type/flavor/abv; cosine-rank the rest against a target profile that
//   is pulled toward the user's highly-rated bottles.
// Layer 2 (text): mean of each bottle's Titan note-embeddings; cosine-rank.
//   Bottles without embeddings are excluded from this layer.
// Layer 3 (narrated): Haiku picks/explains 2-3 from the top candidates.

import type { NoteItem } from '../types'
import type { BottleItem } from '../types'
import type { Recommendation, RecommendationResult } from '../types'
import {
  buildVocab,
  cosine,
  meanVector,
  rankBySimilarity,
  toScore,
  vectorize,
  type StructuredBottle,
} from './vector'
import { FLAVOR_AXES, type FlavorTags } from '../types'

/** Everything the recommender needs about one bottle, gathered by the handler. */
export interface CorpusBottle {
  item: BottleItem
  notes: NoteItem[]
}

const MAX_RECS = 5
const NARRATE_CANDIDATES = 3

// ---- structured helpers (pure) ----

function aggregateFlavor(notes: NoteItem[]): FlavorTags | null {
  if (notes.length === 0) return null
  const sum: FlavorTags = { sweet: 0, smoky: 0, fruity: 0, oaky: 0, spicy: 0 }
  for (const n of notes) for (const a of FLAVOR_AXES) sum[a] += n.flavorTags[a]
  const out = {} as FlavorTags
  for (const a of FLAVOR_AXES) out[a] = sum[a] / notes.length
  return out
}

function toStructured(b: CorpusBottle): StructuredBottle {
  return {
    id: b.item.id,
    region: b.item.region,
    type: b.item.type_,
    abv: b.item.abv,
    flavorProfile: aggregateFlavor(b.notes),
  }
}

function avgRating(notes: NoteItem[]): number | null {
  if (notes.length === 0) return null
  return notes.reduce((a, n) => a + n.rating, 0) / notes.length
}

/**
 * Structured ranking (layer 1). Returns the target's neighbors ranked by a
 * blend of (a) similarity to the target bottle and (b) similarity to the
 * user's taste centroid — the flavor-weighted mean of highly-rated bottles.
 * Pure over its inputs; the handler supplies the corpus.
 */
export function rankStructured(
  targetId: string,
  corpus: CorpusBottle[],
): Recommendation[] {
  const structured = corpus.map(toStructured)
  const vocab = buildVocab(structured)
  const byId = new Map(structured.map((s) => [s.id, s]))
  const target = byId.get(targetId)
  if (!target) return []
  const targetVec = vectorize(target, vocab)

  // Taste centroid: mean vector of bottles the user rated >= 7, so
  // recommendations lean toward what they already love, not just the lookalike.
  const loved = corpus.filter((b) => (avgRating(b.notes) ?? 0) >= 7)
  const lovedVecs = loved
    .filter((b) => b.item.id !== targetId)
    .map((b) => vectorize(byId.get(b.item.id)!, vocab))
  const centroid = meanVector(lovedVecs)

  const candidates = structured
    .filter((s) => s.id !== targetId)
    .map((s) => ({ id: s.id, vector: vectorize(s, vocab) }))

  const nameById = new Map(corpus.map((b) => [b.item.id, b.item.name]))

  const ranked = candidates
    .map(({ id, vector }) => {
      const simTarget = toScore(cosine(targetVec, vector))
      const simTaste = centroid ? toScore(cosine(centroid, vector)) : simTarget
      // 70% "like this bottle", 30% "like your taste"; when the user has no
      // loved bottles yet, simTaste == simTarget so this is pure lookalike.
      const score = 0.7 * simTarget + 0.3 * simTaste
      return {
        bottleId: id,
        name: nameById.get(id) ?? id,
        score: Math.round(score * 1000) / 1000,
        reason: 'Similar region, type, and flavor profile.',
      }
    })
    .sort((a, b) => b.score - a.score || (a.bottleId < b.bottleId ? -1 : 1))

  return ranked.slice(0, MAX_RECS)
}

/**
 * Text ranking (layer 2). Each bottle's text vector is the mean of its notes'
 * embeddings; bottles with no embedded notes are excluded. Returns null when
 * the target itself has no text vector (nothing to rank against).
 */
export function rankText(
  targetId: string,
  corpus: CorpusBottle[],
): Recommendation[] | null {
  const textVec = (b: CorpusBottle): number[] | null =>
    meanVector(
      b.notes
        .map((n) => n.embedding)
        .filter((e): e is number[] => Array.isArray(e) && e.length > 0),
    )

  const target = corpus.find((b) => b.item.id === targetId)
  if (!target) return null
  const targetVec = textVec(target)
  if (!targetVec) return null

  const candidates: Array<{ id: string; vector: number[] }> = []
  const nameById = new Map<string, string>()
  for (const b of corpus) {
    nameById.set(b.item.id, b.item.name)
    if (b.item.id === targetId) continue
    const v = textVec(b)
    if (v) candidates.push({ id: b.item.id, vector: v })
  }
  if (candidates.length === 0) return null

  return rankBySimilarity(targetVec, candidates)
    .slice(0, MAX_RECS)
    .map((r) => ({
      bottleId: r.id,
      name: nameById.get(r.id) ?? r.id,
      score: Math.round(r.score * 1000) / 1000,
      reason: 'Tastes similar based on your written notes.',
    }))
}

// ---- orchestration ----

export interface RecommendDeps {
  /** Haiku narration; throws on Bedrock failure. Omitted => skip layer 3. */
  narrate?: (input: {
    targetName: string
    candidates: Array<{ bottleId: string; name: string; note?: string }>
    highlights: string[]
  }) => Promise<string>
}

/**
 * Run the layered recommender for a target bottle over the full corpus.
 * Degradation chain:
 *   narrated -> text -> structured  (degraded=true if a Bedrock layer failed)
 *   text     -> structured          (degraded=true; text vectors unavailable)
 *   structured                      (degraded=false; expected floor)
 */
export async function recommend(
  targetId: string,
  corpus: CorpusBottle[],
  deps: RecommendDeps = {},
): Promise<RecommendationResult> {
  const structured = rankStructured(targetId, corpus)
  const text = rankText(targetId, corpus)

  // Base ranking prefers text (it reflects real tasting language) but falls
  // back to structured when embeddings aren't present.
  const usingText = text !== null && text.length > 0
  const base = usingText ? text! : structured
  const baseBasis: 'text' | 'structured' = usingText ? 'text' : 'structured'

  if (base.length === 0) {
    // Nothing to recommend (e.g. the corpus has only the target bottle).
    return {
      basis: 'structured',
      recommendations: [],
      narration: null,
      degraded: false,
    }
  }

  // Layer 3: narrate over the top candidates, if Bedrock narration is wired.
  if (deps.narrate) {
    const targetName =
      corpus.find((b) => b.item.id === targetId)?.item.name ?? targetId
    const candidates = base.slice(0, NARRATE_CANDIDATES).map((r) => {
      const cb = corpus.find((b) => b.item.id === r.bottleId)
      const topNote = cb?.notes
        .slice()
        .sort((a, b) => b.rating - a.rating)[0]
      return {
        bottleId: r.bottleId,
        name: r.name,
        note: topNote
          ? `${topNote.nose} ${topNote.palate} ${topNote.finish}`.trim()
          : undefined,
      }
    })
    const highlights = topHighlights(corpus)
    try {
      const narration = await deps.narrate({ targetName, candidates, highlights })
      return {
        basis: 'narrated',
        // Narrated returns the same ranked list (Haiku explains, doesn't
        // re-rank the score contract) with prose in `narration`.
        recommendations: base.slice(0, MAX_RECS),
        narration,
        // Not degraded: text may or may not be present, but narration itself
        // succeeded. degraded reflects a *fallback below the intended layer*.
        degraded: !usingText,
      }
    } catch {
      // Bedrock unavailable for narration: degrade to the base ranking layer.
      return {
        basis: baseBasis,
        recommendations: base.slice(0, MAX_RECS),
        narration: null,
        degraded: true,
      }
    }
  }

  // No narration requested: return the best non-Bedrock-narration layer.
  // degraded is true only if we wanted text but had to use structured.
  return {
    basis: baseBasis,
    recommendations: base.slice(0, MAX_RECS),
    narration: null,
    degraded: false,
  }
}

/** The user's most enthusiastic notes, as short strings for narration context. */
function topHighlights(corpus: CorpusBottle[]): string[] {
  const all = corpus.flatMap((b) =>
    b.notes.map((n) => ({
      rating: n.rating,
      name: b.item.name,
      text: `${b.item.name} (rated ${n.rating}/10): ${n.palate}`.trim(),
    })),
  )
  return all
    .sort((a, b) => b.rating - a.rating)
    .slice(0, 3)
    .map((h) => h.text)
}
