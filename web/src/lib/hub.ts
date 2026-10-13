/**
 * Pure helpers for the account hub (`#/account`): flatten the corpus's notes
 * into one reverse-chronological stream, and derive the drinker's aggregate
 * palate from them. Kept DOM-free so it's unit-testable.
 *
 * Note on "your" notes: dram is a personal, invite-only log — notes carry no
 * author field, so the hub treats the whole corpus as the drinker's history.
 */
import type { Bottle, BottleDetail, FlavorTags, TastingNote } from './types'
import { EMPTY_FLAVOR, FLAVOR_AXES } from './types'
import { ApiError, type DramApi } from './api'

/** How many per-bottle reads the fallback keeps in flight. A Lambda's account
 *  concurrency can be as low as 10; a request per bottle, all at once, turns a
 *  big cabinet into a 503. */
export const DETAIL_CONCURRENCY = 4

/**
 * The whole corpus — every bottle with its notes — in two reads: the bottle
 * list and GET /notes. An API from before that route answers 404, and then it
 * is one read per bottle, a few at a time, never the lot in parallel.
 */
export async function loadCorpus(api: DramApi): Promise<BottleDetail[]> {
  const [bottles, notes] = await Promise.all([
    api.listBottles(),
    api.listNotes().catch((e: unknown) => {
      if (e instanceof ApiError && e.status === 404) return null
      throw e
    }),
  ])
  if (notes) return detailsFrom(bottles, notes)
  return mapLimit(bottles, DETAIL_CONCURRENCY, (b) => api.getBottle(b.id))
}

/** Join every note to its bottle, newest first within each. A note whose
 *  bottle is gone is dropped. */
export function detailsFrom(bottles: Bottle[], notes: TastingNote[]): BottleDetail[] {
  const byBottle = new Map<string, TastingNote[]>()
  for (const n of notes) {
    const arr = byBottle.get(n.bottleId)
    if (arr) arr.push(n)
    else byBottle.set(n.bottleId, [n])
  }
  return bottles.map((bottle) => ({
    bottle,
    notes: (byBottle.get(bottle.id) ?? []).sort((a, b) =>
      b.createdAt.localeCompare(a.createdAt),
    ),
  }))
}

/** `Promise.all` with at most `limit` calls in flight; results keep order. */
export async function mapLimit<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array<R>(items.length)
  let next = 0
  const worker = async () => {
    while (next < items.length) {
      const i = next++
      results[i] = await fn(items[i])
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker))
  return results
}

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

export interface GearStats {
  /** [name, timesUsed], most-used first. */
  grinders: Array<[string, number]>
  methods: Array<[string, number]>
}

/** Grinders and methods/machines pulled from coffee notes' brew metadata,
 *  with use counts — the account page's "your coffee gear" panel. */
export function gearStats(notes: HubNote[]): GearStats {
  const grinders = new Map<string, number>()
  const methods = new Map<string, number>()
  for (const n of notes) {
    if (n.brew?.grinder) {
      grinders.set(n.brew.grinder, (grinders.get(n.brew.grinder) ?? 0) + 1)
    }
    if (n.brew?.method) {
      methods.set(n.brew.method, (methods.get(n.brew.method) ?? 0) + 1)
    }
  }
  const desc = (m: Map<string, number>) =>
    [...m.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
  return { grinders: desc(grinders), methods: desc(methods) }
}
