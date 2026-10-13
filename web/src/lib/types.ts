/**
 * FROZEN REST API contract types — mirror the backend exactly. The backend
 * agent implements the same shapes in parallel; do not diverge without a
 * contract change on both sides.
 */

/**
 * Beverage categories, grouped the way the add-form dropdown shows them.
 * Free-form on the wire (the API accepts any short string), but these are the
 * values the seed data and the form use, and the pairing engine keys its type
 * affinities by them. `other` is the escape hatch for anything not listed
 * (sake, cider, baijiu, a weird liqueur…) — the style field describes it.
 *
 * Whisky is split the way a shelf is: the four big origins plus the American
 * sub-categories that taste nothing alike (a Tennessee whiskey and a rye are
 * both "American"), and `world whisky` for Taiwan / India / Australia / Wales.
 */
export const TYPE_GROUPS = [
  {
    id: 'whisky',
    label: 'Whisky',
    types: [
      'scotch',
      'irish',
      'bourbon',
      'rye',
      'tennessee whiskey',
      'american whiskey',
      'japanese whisky',
      'canadian whisky',
      'world whisky',
    ],
  },
  { id: 'agave', label: 'Agave', types: ['tequila', 'mezcal'] },
  { id: 'cane', label: 'Cane', types: ['rum', 'cachaça'] },
  {
    id: 'brandy',
    label: 'Brandy',
    types: ['cognac', 'armagnac', 'calvados', 'pisco', 'brandy'],
  },
  { id: 'botanical', label: 'Botanical & grain', types: ['gin', 'vodka', 'absinthe'] },
  { id: 'liqueur', label: 'Liqueur & aperitif', types: ['liqueur', 'amaro', 'vermouth'] },
  {
    id: 'wine',
    label: 'Wine',
    types: [
      'red wine',
      'white wine',
      'rosé wine',
      'sparkling wine',
      'fortified wine',
      'dessert wine',
    ],
  },
  { id: 'coffee', label: 'Coffee', types: ['coffee'] },
  { id: 'other', label: 'Other', types: ['other'] },
] as const satisfies readonly {
  id: string
  label: string
  types: readonly string[]
}[]

export type BottleType = (typeof TYPE_GROUPS)[number]['types'][number]
export type TypeGroupId = (typeof TYPE_GROUPS)[number]['id']

/** Every canonical type, flat, in dropdown order. */
export const BOTTLE_TYPES: readonly BottleType[] = TYPE_GROUPS.flatMap(
  (g) => g.types,
)

/** Types are free-form on the wire; compare them the way familyOf does so an
 *  API-written "Scotch" is still scotch. */
export function canonicalType(type: string): string {
  return type.trim().toLowerCase()
}

/** The group a type belongs to (`whisky`, `wine`…); undefined for free-form
 *  values stored outside the canon. */
export function typeGroupOf(type: string): TypeGroupId | undefined {
  const t = canonicalType(type)
  return TYPE_GROUPS.find((g) => (g.types as readonly string[]).includes(t))?.id
}

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
export const isWine = (t: string) => typeGroupOf(t) === 'wine'
/** Any alcohol that isn't wine — whisky, agave, cane, brandy, botanical, and
 *  `other`, whose style field doubles as its description. */
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

/**
 * Where a bottle stands with the drinker. `cabinet` is on the shelf — the
 * default, and what every bottle logged before this field existed reads as;
 * `finished` was owned and is gone, its notes kept; `tasted` was tried
 * somewhere else (a bar, a friend's, a distillery) and never owned. Pairing's
 * "what to pour" and tonight's picks draw from the cabinet only; "bottles like
 * this", menu tips, and your palate use all three.
 */
export type BottleStatus = 'cabinet' | 'finished' | 'tasted'
export const BOTTLE_STATUSES = ['cabinet', 'finished', 'tasted'] as const

/** How each status reads in the form, the filters, and on a card. */
export const STATUS_LABELS: Record<BottleStatus, string> = {
  cabinet: 'on the shelf',
  finished: 'finished',
  tasted: 'tasted elsewhere',
}

/** What can be poured tonight. */
export const onShelf = (b: Pick<Bottle, 'status'>) => b.status === 'cabinet'

export interface Bottle {
  id: string
  name: string
  producer: string
  region: string
  type: string
  abv: number
  price: number | null
  /** Always present on the wire; the API fills `cabinet` in for older rows. */
  status: BottleStatus
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

/** Cigar strength, as the pairing form collects it. */
export type CigarStrength = 'mild' | 'medium' | 'full'

/**
 * Request body for POST /pairings — what the drinker is having. The structured
 * pairing (layer 1, `lib/pairing.ts`) runs client-side; this asks the API for
 * the narrated take over the real cabinet. `candidateIds` is the client's
 * flavor-math shortlist so the narration can agree with it or push back.
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

/** Input limits the API enforces on POST /pairings (400 beyond them); the
 *  form caps its fields to match so a long paste can't silently lose the
 *  narration. Mirrored in api/src/types.ts. */
export const PAIRING_LIMITS = {
  /** The dish, as typed. */
  text: 200,
  /** Cigar brand / line. */
  field: 80,
  wrapper: 40,
  /** Shortlisted bottle ids sent along for the narration. */
  candidates: 5,
} as const

/** Response shape for POST /pairings. `narration` is null (and `degraded`
 *  true) when the narration layer was unavailable — the client's structured
 *  picks still stand. */
export interface PairingNarration {
  narration: string | null
  degraded: boolean
}

/** Response shape for GET /notes: every note in the corpus, newest first, as
 *  `TastingNote[]` — the hub's one read for the whole tasting history. */

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
  /** Defaults to `cabinet` when omitted. */
  status?: BottleStatus
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
