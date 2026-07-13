/**
 * In-memory mock backend implementing the FULL frozen contract. Seeded with a
 * cabinet of realistic bottles (scotch / bourbon / rye / Irish / agave / rum /
 * gin / absinthe / cognac / wine) plus a shelf of coffees, each with 1–3
 * tasting notes, a flavor profile, and ratings. POSTs mutate the store, so
 * adding a bottle or note is visible immediately and recommendations recompute
 * live off the current data.
 *
 * Recommendation results are derived: mostly `basis:"structured"` from the
 * shared similarity math, with a couple carrying `narration` (to demo the
 * layer-3 narrated experience) and one flagged `degraded:true` (to demo the
 * fallback banner). The main list stays within the target's family; the
 * `crossFamily` picks bridge coffee ↔ the cabinet.
 */
import type {
  Bottle,
  BottleDetail,
  FlavorTags,
  Recommendation,
  RecommendationBasis,
  RecommendationResult,
  TastingNote,
} from './types'
import { EMPTY_FLAVOR, FLAVOR_AXES, familyOf } from './types'
import type { DramApi } from './api'
import { ApiError } from './api'
import { rankBySimilarity, type ScoredBottle } from './recommend'

const NOW = Date.parse('2026-06-01T12:00:00Z')
const DAY = 86_400_000

/** Build a full 8-axis profile from the axes worth mentioning; rest are 0. */
function flavor(tags: Partial<FlavorTags>): FlavorTags {
  return { ...EMPTY_FLAVOR, ...tags }
}

/** Average of a bottle's note ratings, rounded to 1dp; null when noteless. */
function avg(notes: TastingNote[]): number | null {
  if (notes.length === 0) return null
  const sum = notes.reduce((a, n) => a + n.rating, 0)
  return Math.round((sum / notes.length) * 10) / 10
}

/** Mean flavor profile across a bottle's notes; null when noteless. */
function meanProfile(notes: TastingNote[]): FlavorTags | null {
  if (notes.length === 0) return null
  const out = { ...EMPTY_FLAVOR }
  for (const axis of FLAVOR_AXES) {
    const sum = notes.reduce((a, n) => a + n.flavorTags[axis], 0)
    out[axis] = Math.round((sum / notes.length) * 10) / 10
  }
  return out
}

interface Seed {
  bottle: Omit<
    Bottle,
    'avgRating' | 'flavorProfile' | 'noteCount' | 'createdAt'
  > & { createdAtDaysAgo: number }
  notes: Array<Omit<TastingNote, 'id' | 'bottleId' | 'createdAt'>>
}

/** Twenty-one pours that tell a coherent tasting story across the families. */
const SEEDS: Seed[] = [
  {
    bottle: {
      id: 'b-lagavulin-16',
      name: 'Lagavulin 16',
      producer: 'Lagavulin',
      region: 'Islay',
      type: 'scotch',
      abv: 43,
      price: 95,
      createdAtDaysAgo: 60,
    },
    notes: [
      {
        nose: 'Iodine, wet campfire, and a lick of sea salt.',
        palate: 'Huge peat smoke, seaweed, tar, and dried fruit underneath.',
        finish: 'Long, medicinal, smoke that will not quit.',
        rating: 9,
        flavorTags: flavor({ sweet: 1, smoky: 5, fruity: 2, oaky: 3, spicy: 3, acidity: 1, body: 4 }),
      },
      {
        nose: 'Bonfire embers and a touch of sweet sherry.',
        palate: 'Smoky and rich, brine and dark chocolate.',
        finish: 'Warming, ashy, very long.',
        rating: 9,
        flavorTags: flavor({ sweet: 2, smoky: 5, fruity: 2, oaky: 3, spicy: 2, acidity: 1, body: 5 }),
      },
    ],
  },
  {
    bottle: {
      id: 'b-ardbeg-10',
      name: 'Ardbeg 10',
      producer: 'Ardbeg',
      region: 'Islay',
      type: 'scotch',
      abv: 46,
      price: 55,
      createdAtDaysAgo: 54,
    },
    notes: [
      {
        nose: 'Lemon, brine, and a wall of soot.',
        palate: 'Aggressive peat, black pepper, and green fruit.',
        finish: 'Espresso and smoke, bone dry.',
        rating: 9,
        flavorTags: flavor({ sweet: 1, smoky: 5, fruity: 3, oaky: 2, spicy: 4, floral: 1, acidity: 2, body: 3 }),
      },
    ],
  },
  {
    bottle: {
      id: 'b-glenfiddich-12',
      name: 'Glenfiddich 12',
      producer: 'Glenfiddich',
      region: 'Speyside',
      type: 'scotch',
      abv: 40,
      price: 45,
      createdAtDaysAgo: 48,
    },
    notes: [
      {
        nose: 'Fresh pear, cut apple, and a hint of oak.',
        palate: 'Light, malty, orchard fruit and a whisper of vanilla.',
        finish: 'Short, clean, gently sweet.',
        rating: 7,
        flavorTags: flavor({ sweet: 3, fruity: 4, oaky: 2, spicy: 1, floral: 2, acidity: 2, body: 2 }),
      },
      {
        nose: 'Green apple and honeysuckle.',
        palate: 'Delicate, creamy, subtle spice.',
        finish: 'Mellow and fruity.',
        rating: 6,
        flavorTags: flavor({ sweet: 3, fruity: 4, oaky: 2, spicy: 1, floral: 3, acidity: 2, body: 2 }),
      },
    ],
  },
  {
    bottle: {
      id: 'b-macallan-12-sherry',
      name: 'Macallan 12 Sherry Oak',
      producer: 'The Macallan',
      region: 'Speyside',
      type: 'scotch',
      abv: 43,
      price: 75,
      createdAtDaysAgo: 42,
    },
    notes: [
      {
        nose: 'Dried fruit, sherry, ginger, and orange.',
        palate: 'Rich, raisiny, oaky, warm holiday spice.',
        finish: 'Long, sweet, drying oak.',
        rating: 8,
        flavorTags: flavor({ sweet: 4, smoky: 1, fruity: 4, oaky: 4, spicy: 3, floral: 1, acidity: 1, body: 4 }),
      },
    ],
  },
  {
    bottle: {
      id: 'b-buffalo-trace',
      name: 'Buffalo Trace',
      producer: 'Buffalo Trace Distillery',
      region: 'Kentucky',
      type: 'bourbon',
      abv: 45,
      price: 30,
      createdAtDaysAgo: 38,
    },
    notes: [
      {
        nose: 'Vanilla, caramel, and a little mint.',
        palate: 'Brown sugar, toffee, oak, and baking spice.',
        finish: 'Medium, sweet, warm.',
        rating: 8,
        flavorTags: flavor({ sweet: 4, smoky: 1, fruity: 2, oaky: 4, spicy: 3, acidity: 1, body: 3 }),
      },
      {
        nose: 'Corn sweetness and candied orange.',
        palate: 'Smooth caramel with a peppery kick.',
        finish: 'Clean and moreish.',
        rating: 8,
        flavorTags: flavor({ sweet: 4, fruity: 2, oaky: 3, spicy: 3, acidity: 1, body: 3 }),
      },
    ],
  },
  {
    bottle: {
      id: 'b-makers-mark',
      name: "Maker's Mark",
      producer: "Maker's Mark",
      region: 'Kentucky',
      type: 'bourbon',
      abv: 45,
      price: 32,
      createdAtDaysAgo: 34,
    },
    notes: [
      {
        nose: 'Soft wheat, caramel, and vanilla.',
        palate: 'Sweet and gentle, no rye bite, honeyed oak.',
        finish: 'Smooth and short.',
        rating: 7,
        flavorTags: flavor({ sweet: 5, fruity: 2, oaky: 3, spicy: 1, floral: 1, body: 3 }),
      },
    ],
  },
  {
    bottle: {
      id: 'b-eagle-rare-10',
      name: 'Eagle Rare 10',
      producer: 'Buffalo Trace Distillery',
      region: 'Kentucky',
      type: 'bourbon',
      abv: 45,
      price: 40,
      createdAtDaysAgo: 30,
    },
    notes: [
      {
        nose: 'Toffee, leather, and orange peel.',
        palate: 'Dry oak, dark caramel, cocoa, and herbs.',
        finish: 'Long, dry, and complex.',
        rating: 9,
        flavorTags: flavor({ sweet: 3, smoky: 1, fruity: 3, oaky: 5, spicy: 3, acidity: 1, body: 4 }),
      },
    ],
  },
  {
    bottle: {
      id: 'b-rittenhouse-rye',
      name: 'Rittenhouse Rye BiB',
      producer: 'Heaven Hill',
      region: 'Kentucky',
      type: 'rye',
      abv: 50,
      price: 28,
      createdAtDaysAgo: 26,
    },
    notes: [
      {
        nose: 'Rye spice, clove, and dark honey.',
        palate: 'Bold cinnamon, pepper, and a dried-fruit core.',
        finish: 'Hot, spicy, and long.',
        rating: 8,
        flavorTags: flavor({ sweet: 3, smoky: 1, fruity: 2, oaky: 3, spicy: 5, acidity: 1, body: 3 }),
      },
      {
        nose: 'Baking spice and toasted grain.',
        palate: 'Peppery and full, caramel underneath.',
        finish: 'Warming spice.',
        rating: 8,
        flavorTags: flavor({ sweet: 2, smoky: 1, fruity: 2, oaky: 3, spicy: 5, acidity: 1, body: 3 }),
      },
    ],
  },
  {
    bottle: {
      id: 'b-whistlepig-10',
      name: 'WhistlePig 10',
      producer: 'WhistlePig',
      region: 'Vermont',
      type: 'rye',
      abv: 50,
      price: 75,
      createdAtDaysAgo: 22,
    },
    notes: [
      {
        nose: 'Orange oil, caraway, and mint.',
        palate: 'Rich rye spice, allspice, and toasted oak.',
        finish: 'Long, warming, and elegant.',
        rating: 9,
        flavorTags: flavor({ sweet: 3, fruity: 3, oaky: 4, spicy: 5, floral: 1, acidity: 1, body: 4 }),
      },
    ],
  },
  {
    bottle: {
      id: 'b-redbreast-12',
      name: 'Redbreast 12',
      producer: 'Midleton',
      region: 'Ireland',
      type: 'irish',
      abv: 40,
      price: 65,
      createdAtDaysAgo: 18,
    },
    notes: [
      {
        nose: 'Sherry, marzipan, and stewed fruit.',
        palate: 'Creamy pot-still spice, nuts, and dried fruit.',
        finish: 'Long, oily, and satisfying.',
        rating: 9,
        flavorTags: flavor({ sweet: 4, fruity: 4, oaky: 3, spicy: 3, floral: 1, acidity: 1, body: 4 }),
      },
    ],
  },
  {
    bottle: {
      id: 'b-fortaleza-blanco',
      name: 'Fortaleza Blanco',
      producer: 'Tequila Los Abuelos',
      region: 'Jalisco',
      type: 'tequila',
      style: 'blanco',
      abv: 40,
      price: 62,
      createdAtDaysAgo: 21,
    },
    notes: [
      {
        nose: 'Cooked agave, lime peel, and olive brine.',
        palate: 'Buttery agave, white pepper, and bright citrus.',
        finish: 'Clean, peppery, gently sweet.',
        rating: 9,
        flavorTags: flavor({ sweet: 2, fruity: 3, spicy: 3, floral: 2, acidity: 3, body: 2 }),
      },
    ],
  },
  {
    bottle: {
      id: 'b-del-maguey-vida',
      name: 'Del Maguey Vida',
      producer: 'Del Maguey',
      region: 'Oaxaca',
      type: 'mezcal',
      style: 'espadín',
      abv: 42,
      price: 38,
      createdAtDaysAgo: 19,
    },
    notes: [
      {
        nose: 'Roasted agave, campfire embers, and green apple.',
        palate: 'Earthy smoke, tropical fruit, and black pepper.',
        finish: 'Smoky, mineral, medium-long.',
        rating: 8,
        flavorTags: flavor({ sweet: 1, smoky: 4, fruity: 2, oaky: 1, spicy: 3, floral: 1, acidity: 2, body: 2 }),
      },
    ],
  },
  {
    bottle: {
      id: 'b-appleton-12',
      name: 'Appleton Estate 12',
      producer: 'Appleton Estate',
      region: 'Jamaica',
      type: 'rum',
      style: 'aged pot still',
      abv: 43,
      price: 45,
      createdAtDaysAgo: 16,
    },
    notes: [
      {
        nose: 'Ripe banana, orange peel, and warm oak.',
        palate: 'Molasses, dried apricot, baking spice, and a funky edge.',
        finish: 'Long, oaky, gently sweet.',
        rating: 8,
        flavorTags: flavor({ sweet: 4, fruity: 4, oaky: 3, spicy: 2, floral: 1, acidity: 2, body: 3 }),
      },
    ],
  },
  {
    bottle: {
      id: 'b-monkey-47',
      name: 'Monkey 47',
      producer: 'Black Forest Distillers',
      region: 'Black Forest',
      type: 'gin',
      style: 'dry gin',
      abv: 47,
      price: 70,
      createdAtDaysAgo: 14,
    },
    notes: [
      {
        nose: 'A herb garden — juniper, lavender, and citrus zest.',
        palate: 'Piney and floral, cracked pepper, bright lime.',
        finish: 'Crisp, botanical, long.',
        rating: 8,
        flavorTags: flavor({ sweet: 1, fruity: 3, spicy: 2, floral: 5, acidity: 4, body: 2 }),
      },
    ],
  },
  {
    bottle: {
      id: 'b-st-george-absinthe',
      name: 'St. George Absinthe Verte',
      producer: 'St. George Spirits',
      region: 'California',
      type: 'absinthe',
      style: 'verte',
      abv: 60,
      price: 65,
      createdAtDaysAgo: 11,
    },
    notes: [
      {
        nose: 'Star anise, fennel, and fresh mint.',
        palate: 'Louche and silky — anise, basil, and a cool herbal sweetness.',
        finish: 'Long, numbing, garden-fresh.',
        rating: 7,
        flavorTags: flavor({ sweet: 2, fruity: 1, spicy: 3, floral: 4, acidity: 1, body: 3 }),
      },
    ],
  },
  {
    bottle: {
      id: 'b-ferrand-1840',
      name: 'Pierre Ferrand 1840',
      producer: 'Maison Ferrand',
      region: 'Cognac',
      type: 'cognac',
      style: '1840 formula',
      abv: 45,
      price: 50,
      createdAtDaysAgo: 9,
    },
    notes: [
      {
        nose: 'Baked apricot, honey, and toasted oak.',
        palate: 'Rich orchard fruit, vanilla, and gentle rancio.',
        finish: 'Warm, fruity, drying oak.',
        rating: 8,
        flavorTags: flavor({ sweet: 4, fruity: 4, oaky: 3, spicy: 2, floral: 2, acidity: 2, body: 3 }),
      },
    ],
  },
  {
    bottle: {
      id: 'b-caymus-cab',
      name: 'Caymus Cabernet Sauvignon',
      producer: 'Caymus Vineyards',
      region: 'Napa Valley',
      type: 'red wine',
      grape: 'Cabernet Sauvignon',
      abv: 15,
      price: 90,
      createdAtDaysAgo: 12,
    },
    notes: [
      {
        nose: 'Cassis, blackberry jam, and vanilla oak.',
        palate: 'Plush dark fruit, mocha, and soft tannins.',
        finish: 'Long, velvety, and sweet-edged.',
        rating: 8,
        flavorTags: flavor({ sweet: 4, fruity: 5, oaky: 4, spicy: 2, floral: 1, acidity: 3, body: 5 }),
      },
    ],
  },
  {
    bottle: {
      id: 'b-cloudy-bay-sb',
      name: 'Cloudy Bay Sauvignon Blanc',
      producer: 'Cloudy Bay',
      region: 'Marlborough',
      type: 'white wine',
      grape: 'Sauvignon Blanc',
      abv: 13,
      price: 35,
      createdAtDaysAgo: 6,
    },
    notes: [
      {
        nose: 'Passionfruit, lime zest, and fresh-cut grass.',
        palate: 'Crisp, zesty citrus and gooseberry.',
        finish: 'Bright, clean, mouth-watering.',
        rating: 7,
        flavorTags: flavor({ sweet: 2, fruity: 5, oaky: 1, spicy: 1, floral: 3, acidity: 5, body: 1 }),
      },
      {
        nose: 'Grapefruit and green herbs.',
        palate: 'Racy acidity, tropical fruit.',
        finish: 'Zippy and fresh.',
        rating: 7,
        flavorTags: flavor({ sweet: 2, fruity: 5, spicy: 1, floral: 2, acidity: 5, body: 1 }),
      },
    ],
  },
  {
    bottle: {
      id: 'c-yirgacheffe',
      name: 'Ethiopia Yirgacheffe',
      producer: 'Counter Culture Coffee',
      region: 'Yirgacheffe, Ethiopia',
      type: 'coffee',
      roast: 'light',
      process: 'washed',
      abv: 0,
      price: 19,
      createdAtDaysAgo: 5,
    },
    notes: [
      {
        nose: 'Jasmine, bergamot, and lemon blossom.',
        palate: 'Silky black tea, lemon curd, white peach, sparkling acidity.',
        finish: 'Clean, floral, lingering citrus.',
        rating: 9,
        flavorTags: flavor({ sweet: 3, fruity: 4, floral: 5, acidity: 5, body: 1 }),
      },
      {
        nose: 'Honeysuckle and stone fruit.',
        palate: 'Delicate and tea-like, apricot sweetness.',
        finish: 'Crisp and bright.',
        rating: 8,
        flavorTags: flavor({ sweet: 3, fruity: 4, floral: 4, acidity: 4, body: 1 }),
      },
    ],
  },
  {
    bottle: {
      id: 'c-huila',
      name: 'Colombia Huila',
      producer: 'Intelligentsia',
      region: 'Huila, Colombia',
      type: 'coffee',
      roast: 'medium',
      process: 'washed',
      abv: 0,
      price: 17,
      createdAtDaysAgo: 3,
    },
    notes: [
      {
        nose: 'Caramel, red apple, and a little cocoa.',
        palate: 'Round and sweet — toffee, milk chocolate, gentle citrus.',
        finish: 'Smooth, sweet, medium length.',
        rating: 8,
        flavorTags: flavor({ sweet: 4, fruity: 3, floral: 1, acidity: 3, body: 3, oaky: 1, spicy: 1 }),
      },
    ],
  },
  {
    bottle: {
      id: 'c-sumatra',
      name: 'Sumatra Mandheling',
      producer: 'Blue Bottle Coffee',
      region: 'Sumatra, Indonesia',
      type: 'coffee',
      roast: 'dark',
      process: 'wet-hulled',
      abv: 0,
      price: 18,
      createdAtDaysAgo: 1,
    },
    notes: [
      {
        nose: 'Dark chocolate, cedar, and pipe tobacco.',
        palate: 'Heavy and earthy — bittersweet cocoa, molasses, a curl of smoke.',
        finish: 'Long, resinous, smoky.',
        rating: 7,
        flavorTags: flavor({ sweet: 2, fruity: 1, acidity: 1, body: 5, oaky: 3, smoky: 3, spicy: 2 }),
      },
    ],
  },
]

interface Store {
  bottles: Map<string, Bottle>
  notes: Map<string, TastingNote[]>
}

let idCounter = 1000
function nextId(prefix: string): string {
  idCounter += 1
  return `${prefix}-${idCounter}`
}

function buildStore(): Store {
  const bottles = new Map<string, Bottle>()
  const notes = new Map<string, TastingNote[]>()

  for (const seed of SEEDS) {
    const { createdAtDaysAgo, ...base } = seed.bottle
    const bottleNotes: TastingNote[] = seed.notes.map((n, i) => ({
      ...n,
      id: `${base.id}-n${i + 1}`,
      bottleId: base.id,
      createdAt: new Date(NOW - (createdAtDaysAgo - i) * DAY).toISOString(),
    }))
    notes.set(base.id, bottleNotes)
    bottles.set(base.id, {
      ...base,
      createdAt: new Date(NOW - createdAtDaysAgo * DAY).toISOString(),
      avgRating: avg(bottleNotes),
      flavorProfile: meanProfile(bottleNotes),
      noteCount: bottleNotes.length,
    })
  }

  return { bottles, notes }
}

/** Recompute the derived bottle fields after a note is added. */
function refreshDerived(store: Store, bottleId: string): void {
  const bottle = store.bottles.get(bottleId)
  const bottleNotes = store.notes.get(bottleId) ?? []
  if (!bottle) return
  store.bottles.set(bottleId, {
    ...bottle,
    avgRating: avg(bottleNotes),
    flavorProfile: meanProfile(bottleNotes),
    noteCount: bottleNotes.length,
  })
}

// Simulated network latency so loading states are real in preview.
const wait = () => new Promise((r) => setTimeout(r, 140 + Math.random() * 160))

function requireToken(token: string): void {
  if (!token) throw new ApiError(401, 'Authentication required')
}

/** Trim an optional/nullable per-type field: null/blank clears to undefined. */
function optField(
  v: string | null | undefined,
  prev?: string,
): string | undefined {
  if (v === undefined) return prev
  const t = v === null ? '' : v.trim()
  return t === '' ? undefined : t
}

/**
 * Narration + degraded flavour for specific bottles, so the detail page can
 * demo all three recommendation bases without a live model. Everything else
 * comes back as plain `structured`.
 */
const NARRATED = new Set(['b-lagavulin-16', 'b-redbreast-12', 'c-yirgacheffe'])
const DEGRADED = new Set(['b-cloudy-bay-sb'])

function narrationFor(bottle: Bottle, recs: Recommendation[]): string | null {
  if (!NARRATED.has(bottle.id) || recs.length === 0) return null
  const top = recs[0]
  const second = recs[1]
  return (
    `Because you rated ${bottle.name} highly, I'd reach for ${top.name} next — ` +
    `${top.reason.toLowerCase()}, so it should land in the same register. ` +
    (second
      ? `If you want to stretch a little, ${second.name} keeps the through-line ` +
        `(${second.reason.toLowerCase()}) while shifting the emphasis.`
      : '')
  ).trim()
}

function toRecommendation(r: ScoredBottle): Recommendation {
  return {
    bottleId: r.bottle.id,
    name: r.bottle.name,
    score: Math.round(r.score * 100) / 100,
    reason: r.reason,
  }
}

export function makeMockApi(): DramApi {
  const store = buildStore()

  return {
    async listBottles() {
      await wait()
      return [...store.bottles.values()].sort((a, b) =>
        b.createdAt.localeCompare(a.createdAt),
      )
    },

    async getBottle(id) {
      await wait()
      const bottle = store.bottles.get(id)
      if (!bottle) throw new ApiError(404, `No bottle ${id}`)
      const bottleNotes = [...(store.notes.get(id) ?? [])].sort((a, b) =>
        b.createdAt.localeCompare(a.createdAt),
      )
      return { bottle, notes: bottleNotes } satisfies BottleDetail
    },

    async createBottle(input, token) {
      await wait()
      requireToken(token)
      const id = nextId('b-user')
      const bottle: Bottle = {
        id,
        name: input.name,
        producer: input.producer,
        region: input.region,
        type: input.type,
        abv: input.abv,
        price: input.price ?? null,
        grape: optField(input.grape),
        style: optField(input.style),
        roast: optField(input.roast),
        process: optField(input.process),
        createdAt: new Date().toISOString(),
        avgRating: null,
        flavorProfile: null,
        noteCount: 0,
      }
      store.bottles.set(id, bottle)
      store.notes.set(id, [])
      return bottle
    },

    async updateBottle(id, input, token) {
      await wait()
      requireToken(token)
      const existing = store.bottles.get(id)
      if (!existing) throw new ApiError(404, `No bottle ${id}`)
      const updated: Bottle = {
        ...existing,
        name: input.name ?? existing.name,
        producer: input.producer ?? existing.producer,
        region: input.region ?? existing.region,
        type: input.type ?? existing.type,
        abv: input.abv ?? existing.abv,
        price: input.price === undefined ? existing.price : (input.price ?? null),
        grape: optField(input.grape, existing.grape),
        style: optField(input.style, existing.style),
        roast: optField(input.roast, existing.roast),
        process: optField(input.process, existing.process),
      }
      store.bottles.set(id, updated)
      return updated
    },

    async deleteBottle(id, token) {
      await wait()
      requireToken(token)
      if (!store.bottles.delete(id)) throw new ApiError(404, `No bottle ${id}`)
      store.notes.delete(id)
    },

    async addNote(bottleId, input, token) {
      await wait()
      requireToken(token)
      if (!store.bottles.has(bottleId)) {
        throw new ApiError(404, `No bottle ${bottleId}`)
      }
      const note: TastingNote = {
        id: nextId('n-user'),
        bottleId,
        nose: input.nose,
        palate: input.palate,
        finish: input.finish,
        rating: input.rating,
        flavorTags: input.flavorTags,
        createdAt: new Date().toISOString(),
      }
      const list = store.notes.get(bottleId) ?? []
      list.push(note)
      store.notes.set(bottleId, list)
      refreshDerived(store, bottleId)
      return note
    },

    async getRecommendations(bottleId) {
      await wait()
      const target = store.bottles.get(bottleId)
      if (!target) throw new ApiError(404, `No bottle ${bottleId}`)

      const family = familyOf(target.type)
      const all = [...store.bottles.values()]
      const sameFamily = all.filter((b) => familyOf(b.type) === family)
      const otherFamily = all.filter((b) => familyOf(b.type) !== family)

      // Contract: main list <= 5, crossFamily <= 3 (mirrors the real API).
      const recommendations = rankBySimilarity(target, sameFamily)
        .slice(0, 5)
        .filter((r) => r.score > 0)
        .map(toRecommendation)

      const crossFamily = rankBySimilarity(target, otherFamily)
        .slice(0, 3)
        .filter((r) => r.score > 0)
        .map(toRecommendation)

      const degraded = DEGRADED.has(bottleId)
      const narration = degraded ? null : narrationFor(target, recommendations)
      const basis: RecommendationBasis = degraded
        ? 'structured'
        : narration
          ? 'narrated'
          : target.noteCount >= 2
            ? 'text'
            : 'structured'

      return {
        basis,
        recommendations,
        crossFamily,
        narration,
        degraded,
      } satisfies RecommendationResult
    },

    async health() {
      await wait()
      return { ok: true }
    },
  }
}

// Exposed for tests.
export const __seedCount = SEEDS.length
export { buildStore as __buildStore }
