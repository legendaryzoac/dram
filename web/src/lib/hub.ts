/**
 * Pure helpers for the account hub (`#/account`): flatten the corpus's notes
 * into one reverse-chronological stream, and derive the drinker's aggregate
 * palate from them. Kept DOM-free so it's unit-testable.
 *
 * Note on "your" notes: dram is a personal, invite-only log — notes carry no
 * author field, so the hub treats the whole corpus as the drinker's history.
 */
import type { BottleDetail, FlavorTags, TastingNote } from './types'
import { EMPTY_FLAVOR, FLAVOR_AXES } from './types'

/** A tasting note joined with the bottle it belongs to, for display. */
export interface HubNote extends TastingNote {
  bottleName: string
  bottleType: string
}

/** Every note in the corpus, newest first. */
export function collectNotes(details: BottleDetail[]): HubNote[] {
  return details
    .flatMap(({ bottle, notes }) =>
      notes.map((n) => ({
        ...n,
        bottleName: bottle.name,
        bottleType: bottle.type,
      })),
    )
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
}

/** Mean flavor profile across all notes — the drinker's aggregate palate.
 *  Null when there are no notes yet. */
export function tasteProfile(notes: TastingNote[]): FlavorTags | null {
  if (notes.length === 0) return null
  const out = { ...EMPTY_FLAVOR }
  for (const axis of FLAVOR_AXES) {
    const sum = notes.reduce((a, n) => a + n.flavorTags[axis], 0)
    out[axis] = Math.round((sum / notes.length) * 10) / 10
  }
  return out
}

/** The profile's strongest axes (desc), for "your palate leans …" copy. */
export function topAxes(profile: FlavorTags, count = 2): string[] {
  return [...FLAVOR_AXES]
    .filter((axis) => profile[axis] > 0)
    .sort((a, b) => profile[b] - profile[a])
    .slice(0, count)
}

/** Mean note rating to 1dp, or null with no notes. */
export function averageRating(notes: TastingNote[]): number | null {
  if (notes.length === 0) return null
  const sum = notes.reduce((a, n) => a + n.rating, 0)
  return Math.round((sum / notes.length) * 10) / 10
}
