/**
 * FROZEN REST API contract types — mirror the backend exactly. The backend
 * agent implements the same shapes in parallel; do not diverge without a
 * contract change on both sides.
 */

/** Whiskey/wine categories the app knows about. Free-form on the wire, but
 *  these are the values the seed data + filters use. */
export type BottleType =
  | 'scotch'
  | 'bourbon'
  | 'rye'
  | 'irish'
  | 'red wine'
  | 'white wine'

/** Five tasting axes, each 0..5. Drives the D3 radar chart. */
export interface FlavorTags {
  sweet: number
  smoky: number
  fruity: number
  oaky: number
  spicy: number
}

export interface Bottle {
  id: string
  name: string
  producer: string
  region: string
  type: string
  abv: number
  price: number | null
  /** Prominent grape variety — shown as a label for wines (optional). */
  grape?: string
  createdAt: string
  avgRating: number | null
  flavorProfile: FlavorTags | null
  noteCount: number
}

export interface TastingNote {
  id: string
  bottleId: string
  nose: string
  palate: string
  finish: string
  /** 1..10 */
  rating: number
  flavorTags: FlavorTags
  createdAt: string
}

export interface Recommendation {
  bottleId: string
  name: string
  /** 0..1 */
  score: number
  reason: string
}

export type RecommendationBasis = 'structured' | 'text' | 'narrated'

export interface RecommendationResult {
  basis: RecommendationBasis
  recommendations: Recommendation[]
  narration: string | null
  degraded: boolean
}

/** Response shape for GET /bottles/{id}. */
export interface BottleDetail {
  bottle: Bottle
  notes: TastingNote[]
}

/** Request body for POST /bottles. */
export interface NewBottleInput {
  name: string
  producer: string
  region: string
  type: string
  abv: number
  price?: number | null
  /** Grape variety, for wines (optional). */
  grape?: string
}

/** Request body for POST /bottles/{id}/notes. */
export interface NewNoteInput {
  nose: string
  palate: string
  finish: string
  rating: number
  flavorTags: FlavorTags
}

/** The five flavor axes in a fixed display order (radar + slider order). */
export const FLAVOR_AXES = [
  'sweet',
  'smoky',
  'fruity',
  'oaky',
  'spicy',
] as const satisfies readonly (keyof FlavorTags)[]

export const EMPTY_FLAVOR: FlavorTags = {
  sweet: 0,
  smoky: 0,
  fruity: 0,
  oaky: 0,
  spicy: 0,
}
