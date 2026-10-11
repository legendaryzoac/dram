/**
 * Structured recommender (layer 1 of the README's three). Given a target
 * bottle, feature-vector every other bottle and rank by cosine similarity of
 * their flavor profiles + a couple of metadata bonuses. This is the math the
 * mock uses so POSTed bottles/notes immediately shift recommendations, and
 * it's a faithful stand-in for the real backend's "structured" basis.
 */
import type { Bottle, FlavorTags } from './types'
import { FLAVOR_AXES } from './types'

/** The eight axes as a vector, in FLAVOR_AXES order. An axis missing from
 *  a profile (an API build that predates the 8-axis expansion) reads 0
 *  rather than NaN-poisoning the cosine. Shared with the pairing engine. */
export function flavorVector(f: Partial<FlavorTags>): number[] {
  return FLAVOR_AXES.map((axis) => f[axis] ?? 0)
}

export function cosine(a: number[], b: number[]): number {
  let dot = 0
  let na = 0
  let nb = 0
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i]
    na += a[i] * a[i]
    nb += b[i] * b[i]
  }
  if (na === 0 || nb === 0) return 0
  return dot / (Math.sqrt(na) * Math.sqrt(nb))
}

export interface ScoredBottle {
  bottle: Bottle
  score: number
  reason: string
}

/**
 * Rank `candidates` by similarity to `target`. Bottles without a flavor
 * profile fall back to metadata-only signal so they still place sensibly.
 */
export function rankBySimilarity(
  target: Bottle,
  candidates: Bottle[],
): ScoredBottle[] {
  const targetVec = target.flavorProfile
    ? flavorVector(target.flavorProfile)
    : null

  return candidates
    .filter((b) => b.id !== target.id)
    .map((b) => {
      let score = 0
      const reasons: string[] = []

      if (targetVec && b.flavorProfile) {
        const sim = cosine(targetVec, flavorVector(b.flavorProfile))
        score += sim * 0.7
        const shared = sharedFlavors(target.flavorProfile!, b.flavorProfile)
        if (shared.length) reasons.push(`shares ${shared.join(' & ')} character`)
      }

      // Same type is a strong metadata signal.
      if (b.type === target.type) {
        score += 0.18
        reasons.push(`also ${b.type}`)
      }
      // Same region a weaker one.
      if (b.region === target.region) {
        score += 0.09
        reasons.push(`from ${b.region}`)
      }
      // Nudge toward similarly-rated bottles (both known).
      if (b.avgRating != null && target.avgRating != null) {
        const gap = Math.abs(b.avgRating - target.avgRating)
        score += Math.max(0, 0.05 * (1 - gap / 10))
      }

      const reason =
        reasons.length > 0
          ? capitalize(reasons.slice(0, 2).join(', '))
          : 'Similar overall profile'

      return { bottle: b, score: clamp01(score), reason }
    })
    .sort((a, b) => b.score - a.score)
}

/**
 * Rank bottles against a raw taste profile — e.g. the drinker's aggregate
 * palate on the account hub — rather than against another bottle. Bottles
 * without a flavor profile can't be compared and are excluded.
 */
export function rankByTasteProfile(
  taste: FlavorTags,
  candidates: Bottle[],
): ScoredBottle[] {
  const tasteVec = flavorVector(taste)
  return candidates
    .filter((b) => b.flavorProfile !== null)
    .map((b) => {
      const sim = cosine(tasteVec, flavorVector(b.flavorProfile!))
      const shared = sharedFlavors(taste, b.flavorProfile!)
      const reason =
        shared.length > 0
          ? `Matches your ${shared.slice(0, 2).join(' & ')} lean`
          : 'Close to your overall palate'
      return { bottle: b, score: clamp01(sim), reason }
    })
    .sort((a, b) => b.score - a.score)
}

/** Axes both profiles lean on (>= 3), in FLAVOR_AXES order. */
export function sharedFlavors(a: FlavorTags, b: FlavorTags): string[] {
  return FLAVOR_AXES.filter((axis) => a[axis] >= 3 && b[axis] >= 3)
}

function clamp01(n: number): number {
  return Math.max(0, Math.min(1, n))
}

export function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1)
}
