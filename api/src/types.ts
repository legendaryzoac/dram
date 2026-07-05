// The frozen REST contract, shared by handlers, storage, and the recommender.
// The web workspace builds to the same shapes.

/** Five flavor axes, each 0..5. Used on bottles (aggregate) and notes. */
export interface FlavorTags {
  sweet: number
  smoky: number
  fruity: number
  oaky: number
  spicy: number
}

export const FLAVOR_AXES = [
  'sweet',
  'smoky',
  'fruity',
  'oaky',
  'spicy',
] as const

/** A bottle as returned by the API. Last 3 fields are server-computed on GET. */
export interface Bottle {
  id: string
  name: string
  producer: string
  region: string
  type: string
  abv: number
  price: number | null
  /** Prominent grape variety, mainly for wines (optional, additive). */
  grape?: string
  createdAt: string
  avgRating: number | null
  flavorProfile: FlavorTags | null
  noteCount: number
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
  createdAt: string
}

export interface Recommendation {
  bottleId: string
  name: string
  score: number // 0..1
  reason: string
}

export interface RecommendationResult {
  basis: 'structured' | 'text' | 'narrated'
  recommendations: Recommendation[] // ranked desc, <= 5
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
  grape?: string // optional grape variety (wines)
  createdAt: string
}

/** DynamoDB item for a note: PK=BOTTLE#<id>, SK=NOTE#<ts>#<id>. */
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
  flavorTags: FlavorTags
  createdAt: string
  /** Titan text embedding of nose+palate+finish. Stored, never returned. */
  embedding?: number[]
}
