// Recommender orchestration: tries the best available layer and reports which
// via `basis`, degrading gracefully. `degraded` is true only when Bedrock was
// meant to run (text/narrated) but was unavailable, forcing a fall to layer 1.
//
// The corpus is one shared cabinet across beverage families (alcohol +
// coffee). The main ranking stays within the target's family; `crossFamily`
// separately surfaces the best matches from the other family — which coffees
// a wine points to, and vice versa.
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
import { familyOf } from '../types'
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
const MAX_CROSS = 3
const NARRATE_CANDIDATES = 3
/** Haiku narration needs a real sample to reason over — with only a handful
 *  of same-family candidates it's confident-sounding noise. Below this many
 *  candidates the response stays at the text/structured layer. */
const MIN_NARRATE_POOL = 5

// ---- structured helpers (pure) ----

/** Per-axis mean over the notes that measured that axis — pre-expansion notes
 *  lack the newer axes and shouldn't drag them toward zero. Axes no note
 *  measured stay absent (vectorize fills them with a neutral value). */
function aggregateFlavor(notes: NoteItem[]): Partial<FlavorTags> | null {
  if (notes.length === 0) return null
  const out: Partial<FlavorTags> = {}
  for (const a of FLAVOR_AXES) {
    let sum = 0
    let count = 0
    for (const n of notes) {
      const v = n.flavorTags[a]
      if (typeof v === 'number') {
        sum += v
        count += 1
      }
    }
    if (count > 0) out[a] = sum / count
  }
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

/** Ids of corpus bottles in (or not in) the target's family, target excluded. */
function candidateIds(
  targetId: string,
  corpus: CorpusBottle[],
  sameFamily: boolean,
): Set<string> {
  const target = corpus.find((b) => b.item.id === targetId)
  if (!target) return new Set()
  const family = familyOf(target.item.type_)
  const ids = new Set<string>()
  for (const b of corpus) {
    if (b.item.id === targetId) continue
    if ((familyOf(b.item.type_) === family) === sameFamily) ids.add(b.item.id)
  }
  return ids
}

/**
 * Structured ranking over a candidate subset. Returns candidates ranked by a
 * blend of (a) similarity to the target bottle and (b) similarity to the
 * user's taste centroid — the flavor-weighted mean of highly-rated bottles
 * among the candidates. Pure over its inputs; the vocab spans the whole
 * corpus so vectors line up regardless of the subset ranked.
 */
function rankStructuredAmong(
  targetId: string,
  corpus: CorpusBottle[],
  ids: ReadonlySet<string>,
  reason: string,
): Recommendation[] {
  const structured = corpus.map(toStructured)
  const vocab = buildVocab(structured)
  const byId = new Map(structured.map((s) => [s.id, s]))
  const target = byId.get(targetId)
  if (!target) return []
  const targetVec = vectorize(target, vocab)

  // Taste centroid: mean vector of candidate-side bottles the user rated >= 7,
  // so recommendations lean toward what they already love, not just the
  // lookalike.
  const lovedVecs = corpus
    .filter((b) => ids.has(b.item.id) && (avgRating(b.notes) ?? 0) >= 7)
    .map((b) => vectorize(byId.get(b.item.id)!, vocab))
  const centroid = meanVector(lovedVecs)

  const candidates = structured
    .filter((s) => ids.has(s.id))
    .map((s) => ({ id: s.id, vector: vectorize(s, vocab) }))

  const nameById = new Map(corpus.map((b) => [b.item.id, b.item.name]))

  return candidates
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
        reason,
      }
    })
    .sort((a, b) => b.score - a.score || (a.bottleId < b.bottleId ? -1 : 1))
}

/**
 * Text ranking over a candidate subset. Each bottle's text vector is the mean
 * of its notes' embeddings; bottles with no embedded notes are excluded.
 * Returns null when the target itself has no text vector (nothing to rank
 * against) or no candidate does.
 */
function rankTextAmong(
  targetId: string,
  corpus: CorpusBottle[],
  ids: ReadonlySet<string>,
  reason: string,
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
    if (!ids.has(b.item.id)) continue
    const v = textVec(b)
    if (v) candidates.push({ id: b.item.id, vector: v })
  }
  if (candidates.length === 0) return null

  return rankBySimilarity(targetVec, candidates).map((r) => ({
    bottleId: r.id,
    name: nameById.get(r.id) ?? r.id,
    score: Math.round(r.score * 1000) / 1000,
    reason,
  }))
}

/** Structured ranking (layer 1) within the target's family. */
export function rankStructured(
  targetId: string,
  corpus: CorpusBottle[],
): Recommendation[] {
  return rankStructuredAmong(
    targetId,
    corpus,
    candidateIds(targetId, corpus, true),
    'Similar region, type, and flavor profile.',
  ).slice(0, MAX_RECS)
}

/** Text ranking (layer 2) within the target's family. */
export function rankText(
  targetId: string,
  corpus: CorpusBottle[],
): Recommendation[] | null {
  const ranked = rankTextAmong(
    targetId,
    corpus,
    candidateIds(targetId, corpus, true),
    'Tastes similar based on your written notes.',
  )
  return ranked && ranked.slice(0, MAX_RECS)
}

/**
 * Cross-family picks: the other family's best matches for this target
 * (coffee <-> the cabinet). Prefers the text layer — prose tasting language
 * crosses families far better than metadata — and falls back to structured.
 */
export function rankCross(
  targetId: string,
  corpus: CorpusBottle[],
): Recommendation[] {
  const ids = candidateIds(targetId, corpus, false)
  if (ids.size === 0) return []
  const text = rankTextAmong(
    targetId,
    corpus,
    ids,
    'Your notes describe a similar character.',
  )
  const ranked =
    text && text.length > 0
      ? text
      : rankStructuredAmong(
          targetId,
          corpus,
          ids,
          'A similar flavor profile, across the aisle.',
        )
  return ranked.slice(0, MAX_CROSS)
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
 * Degradation chain (main, same-family ranking):
 *   narrated -> text -> structured  (degraded=true if a Bedrock layer failed)
 *   text     -> structured          (degraded=true; text vectors unavailable)
 *   structured                      (degraded=false; expected floor)
 * `crossFamily` rides along on every path with the other family's best
 * matches; it never affects basis/degraded.
 */
export async function recommend(
  targetId: string,
  corpus: CorpusBottle[],
  deps: RecommendDeps = {},
): Promise<RecommendationResult> {
  const structured = rankStructured(targetId, corpus)
  const text = rankText(targetId, corpus)
  const crossFamily = rankCross(targetId, corpus)

  // Base ranking prefers text (it reflects real tasting language) but falls
  // back to structured when embeddings aren't present.
  const usingText = text !== null && text.length > 0
  const base = usingText ? text! : structured
  const baseBasis: 'text' | 'structured' = usingText ? 'text' : 'structured'

  if (base.length === 0) {
    // Nothing in-family to recommend (e.g. the corpus has only the target).
    return {
      basis: 'structured',
      recommendations: [],
      crossFamily,
      narration: null,
      degraded: false,
    }
  }

  // Layer 3: narrate over the top candidates, if Bedrock narration is wired
  // AND the family has enough candidates for the narration to mean anything.
  const narratePool = candidateIds(targetId, corpus, true).size
  if (deps.narrate && narratePool >= MIN_NARRATE_POOL) {
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
        crossFamily,
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
        crossFamily,
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
    crossFamily,
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
