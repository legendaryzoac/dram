/**
 * FROZEN REST API contract types — mirror the backend exactly. The backend
 * agent implements the same shapes in parallel; do not diverge without a
 * contract change on both sides.
 */

/** Beverage categories the app knows about. Free-form on the wire, but
 *  these are the values the seed data + the add-form dropdown use. */
export type BottleType =
  | 'scotch'
  | 'bourbon'
  | 'rye'
  | 'irish'
  | 'tequila'
  | 'mezcal'
  | 'rum'
  | 'gin'
  | 'absinthe'
  | 'brandy'
  | 'cognac'
  | 'red wine'
  | 'white wine'
  | 'coffee'

/**
 * Beverage families. Coffee lives beside the alcohol cabinet in the same
 * corpus: it gets its own tab, and recommendations rank within the target's
 * family while surfacing the other family separately (`crossFamily`).
 */
export type BeverageFamily = 'alcohol' | 'coffee'

export function familyOf(type: string): BeverageFamily {
  return type.trim().toLowerCase() === 'coffee' ? 'coffee' : 'alcohol'
}

export const isCoffee = (t: string) => familyOf(t) === 'coffee'
export const isWine = (t: string) => t === 'red wine' || t === 'white wine'
/** Any alcohol that isn't wine — whisky, agave, cane, botanical, brandy… */
export const isSpirit = (t: string) => familyOf(t) === 'alcohol' && !isWine(t)

/**
 * Eight tasting axes, each 0..5, shared by every beverage family so radar
 * profiles stay directly comparable across whisky, wine, spirits, and coffee.
 * Drives the D3 radar chart.
 */
export interface FlavorTags {
  sweet: number
  fruity: number
  floral: number
  acidity: number
  body: number
  oaky: number
  smoky: number
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
  /** Expression/style — shown for spirits (optional): reposado, VSOP… */
  style?: string
  /** Roast level — shown for coffee (optional): light / medium / dark… */
  roast?: string
  /** Processing method — shown for coffee (optional): washed / natural… */
  process?: string
  createdAt: string
  avgRating: number | null
  flavorProfile: FlavorTags | null
  noteCount: number
}

/** Canonical roast levels (coffee). Free-form on the wire, but reads and
 *  writes are normalized so "Light" and "light" never fork the filters. */
export const ROAST_LEVELS = [
  'light',
  'light-medium',
  'medium',
  'medium-dark',
  'dark',
] as const

/** Lowercase, trimmed, spaces collapsed to hyphens: "Medium Dark" -> "medium-dark". */
export function normalizeRoast(v: string): string {
  return v.trim().toLowerCase().replace(/\s+/g, '-')
}

/** Optional brew metadata on a tasting note — how a coffee was made. All
 *  free-form strings so "4.33", "1:15", and "3:02" survive as written. */
export interface NoteBrew {
  grinder?: string
  method?: string
  grindSize?: string
  ratio?: string
  time?: string
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
  /** How it was brewed (coffee notes). */
  brew?: NoteBrew
  createdAt: string
  /** Present once a note has been edited. */
  updatedAt?: string
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
  /** Ranked desc, <= 5, same family as the target. */
  recommendations: Recommendation[]
  /** Picks from the other family (coffee <-> the cabinet), ranked desc, <= 3. */
  crossFamily: Recommendation[]
  narration: string | null
  degraded: boolean
}

/** Response shape for GET /bottles/{id}. */
export interface BottleDetail {
  bottle: Bottle
  notes: TastingNote[]
}

/** Request body for POST /bottles. Nullable per-type fields (`grape`, `style`,
 *  `roast`, `process`) accept null to clear the value on edit. */
export interface NewBottleInput {
  name: string
  producer: string
  region: string
  type: string
  abv: number
  price?: number | null
  /** Grape variety, for wines (optional). */
  grape?: string | null
  /** Expression/style, for spirits (optional). */
  style?: string | null
  /** Roast level, for coffee (optional). */
  roast?: string | null
  /** Processing method, for coffee (optional). */
  process?: string | null
}

/** Request body for POST /bottles/{id}/notes and PUT .../notes/{noteId}. */
export interface NewNoteInput {
  nose: string
  palate: string
  finish: string
  rating: number
  flavorTags: FlavorTags
  brew?: NoteBrew
}

/** The eight flavor axes in a fixed display order (radar + slider order): a
 *  rough flavor wheel — sugars -> fruit -> flowers -> brightness -> texture ->
 *  wood -> fire -> spice. */
export const FLAVOR_AXES = [
  'sweet',
  'fruity',
  'floral',
  'acidity',
  'body',
  'oaky',
  'smoky',
  'spicy',
] as const satisfies readonly (keyof FlavorTags)[]

export const EMPTY_FLAVOR: FlavorTags = {
  sweet: 0,
  fruity: 0,
  floral: 0,
  acidity: 0,
  body: 0,
  oaky: 0,
  smoky: 0,
  spicy: 0,
}
