// The frozen REST contract, shared by handlers, storage, and the recommender.
// The web workspace builds to the same shapes.

/**
 * Eight flavor axes, each 0..5, shared by every beverage family so profiles
 * stay directly comparable across whisky, wine, spirits, and coffee. Used on
 * bottles (aggregate) and notes.
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

/** All axes in radar/slider display order (a rough flavor wheel: sugars ->
 *  fruit -> flowers -> brightness -> texture -> wood -> fire -> spice). */
export const FLAVOR_AXES = [
  'sweet',
  'fruity',
  'floral',
  'acidity',
  'body',
  'oaky',
  'smoky',
  'spicy',
] as const

/** The original five axes. Notes written before the 8-axis expansion carry
 *  only these; the newer axes are simply absent on those stored items. */
export const CORE_FLAVOR_AXES = [
  'sweet',
  'smoky',
  'fruity',
  'oaky',
  'spicy',
] as const

/**
 * Beverage families. Coffee lives beside the alcohol cabinet in the same
 * corpus: recommendations rank within the target's family and surface the
 * other family separately (`crossFamily`).
 */
export type BeverageFamily = 'alcohol' | 'coffee'

export function familyOf(type: string): BeverageFamily {
  return type.trim().toLowerCase() === 'coffee' ? 'coffee' : 'alcohol'
}

/**
 * Where a bottle stands with the drinker. `cabinet` is on the shelf — the
 * default, and what every bottle logged before this field existed reads as;
 * `finished` was owned and is gone, its notes kept; `tasted` was tried
 * somewhere else and never owned. Pairing and tonight's picks pour only from
 * the cabinet; recommendations and the taste model use all three.
 */
export type BottleStatus = 'cabinet' | 'finished' | 'tasted'
export const BOTTLE_STATUSES = ['cabinet', 'finished', 'tasted'] as const

/** A bottle as returned by the API. Last 3 fields are server-computed on GET. */
export interface Bottle {
  id: string
  name: string
  producer: string
  region: string
  type: string
  abv: number
  price: number | null
  status: BottleStatus
  /** Prominent grape variety, mainly for wines (optional, additive). */
  grape?: string
  /** Expression/style, mainly for spirits — reposado, VSOP, navy strength… */
  style?: string
  /** Roast level, for coffee — light / medium / dark… */
  roast?: string
  /** Processing method, for coffee — washed / natural / honey… */
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

/** A tasting note. `embedding` is stored server-side and NEVER returned. */
export interface TastingNote {
  id: string
  bottleId: string
  nose: string
  palate: string
  finish: string
  rating: number // 1..10
  flavorTags: FlavorTags
  /** How it was brewed (coffee notes). */
  brew?: NoteBrew
  createdAt: string
  /** Present once a note has been edited. */
  updatedAt?: string
  /** The guest's name, on a note logged through a group tasting. Absent on
   *  the owner's own notes. */
  taster?: string
  /** The group tasting it was logged at (its public id, never its code). */
  tastingId?: string
}

/**
 * Group tasting: the owner opens one and gets a short code that is good for
 * TASTING_TTL_HOURS. Anyone holding the code can log notes against the
 * cabinet's bottles without an account — and nothing else: no bottle edits,
 * no deletes, no note edits.
 */
export const TASTING_TTL_HOURS = 8
/** Ceiling on guest notes per tasting, so a leaked code isn't an open tap. */
export const TASTING_MAX_NOTES = 300
export const TASTING_LIMITS = { label: 60, taster: 40 } as const

export type TastingStatus = 'live' | 'ended' | 'expired'

/** A tasting as its host sees it (GET/POST /tastings). */
export interface Tasting {
  /** Public id — what guest notes carry. */
  id: string
  /** The secret guests type in: 8 characters, shown as XXXX-XXXX. */
  code: string
  label: string
  createdAt: string
  expiresAt: string
  endedAt?: string
  status: TastingStatus
  noteCount: number
}

/** What a code unlocks for a guest (GET /tastings/{code}) — no owner data. */
export interface TastingInvite {
  id: string
  label: string
  expiresAt: string
}

export interface Recommendation {
  bottleId: string
  name: string
  score: number // 0..1
  reason: string
}

export interface RecommendationResult {
  basis: 'structured' | 'text' | 'narrated'
  recommendations: Recommendation[] // ranked desc, <= 5, same family as target
  /** Picks from the other family (coffee <-> the cabinet), ranked desc, <= 3. */
  crossFamily: Recommendation[]
  narration: string | null
  degraded: boolean
}

/** Cigar strength, as the pairing form collects it. */
export type CigarStrength = 'mild' | 'medium' | 'full'

/**
 * Request body for POST /pairings — what the drinker is having. The
 * structured pairing runs in the web client; this endpoint only narrates
 * (Haiku) over the real cabinet. `candidateIds` is the client's flavor-math
 * shortlist so the narration can agree with it or push back.
 */
export type PairingRequest =
  | {
      kind: 'food'
      /** The dish, as typed. */
      text: string
      /** How the client's knowledge base read it (an occasion label), if it did. */
      reading?: string
      candidateIds?: string[]
    }
  | {
      kind: 'cigar'
      brand?: string
      line?: string
      strength: CigarStrength
      wrapper?: string
      candidateIds?: string[]
    }

/** Input limits enforced on POST /pairings (400 beyond them). Mirrored in
 *  web/src/lib/types.ts so the form caps its fields to match. */
export const PAIRING_LIMITS = {
  text: 200,
  field: 80,
  wrapper: 40,
  candidates: 5,
} as const

/** Response shape for POST /pairings. `narration` is null (and `degraded`
 *  true) when the narration layer was unavailable. */
export interface PairingNarration {
  narration: string | null
  degraded: boolean
}

// ---- internal storage shapes (not part of the wire contract) ----

/** DynamoDB item for a bottle: PK=BOTTLE#<id>, SK=META. */
export interface BottleItem {
  pk: string
  sk: 'META'
  type: 'bottle'
  id: string
  name: string
  producer: string
  region: string
  type_: string // `type` clashes with the discriminator; stored as type_
  abv: number
  price: number | null
  /** Absent on rows written before the field existed: read as `cabinet`. */
  status?: BottleStatus
  grape?: string // optional grape variety (wines)
  style?: string // optional expression/style (spirits)
  roast?: string // optional roast level (coffee)
  process?: string // optional processing method (coffee)
  createdAt: string
}

/** DynamoDB item for a note: PK=BOTTLE#<id>, SK=NOTE#<ts>#<id>.
 *  `flavorTags` is Partial because pre-expansion notes carry only the five
 *  CORE_FLAVOR_AXES; aggregation averages each axis over the notes that
 *  actually measured it. */
export interface NoteItem {
  pk: string
  sk: string
  type: 'note'
  id: string
  bottleId: string
  nose: string
  palate: string
  finish: string
  rating: number
  flavorTags: Partial<FlavorTags>
  brew?: NoteBrew
  createdAt: string
  updatedAt?: string
  /** Cognito sub of the author; edits are restricted to this user. Absent on
   *  notes written before attribution existed (first editor claims them). */
  authorSub?: string
  /** Titan text embedding of nose+palate+finish. Stored, never returned. */
  embedding?: number[]
  /** Guest name, on notes logged through a group tasting. */
  taster?: string
  /** Public id of that tasting. */
  tastingId?: string
}

/** DynamoDB item for a group tasting: PK=TASTING#<code>, SK=META. Keyed by
 *  the code so a guest's request is one GetItem; `ttl` lets DynamoDB sweep
 *  the row a day after it expires. */
export interface TastingItem {
  pk: string
  sk: 'META'
  type: 'tasting'
  id: string
  code: string
  label: string
  ownerSub: string
  createdAt: string
  expiresAt: string
  endedAt?: string
  noteCount: number
  /** Epoch seconds — the table's TTL attribute. */
  ttl: number
}
