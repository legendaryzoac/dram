import { describe, expect, it } from 'vitest'
import type { Bottle, FlavorTags } from './types'
import { BOTTLE_TYPES, EMPTY_FLAVOR, TYPE_GROUPS, isSpirit, isWine } from './types'
import {
  CIGAR_BRANDS,
  FOOD_OCCASIONS,
  UNKNOWN_OCCASION,
  affinityFor,
  cigarLabel,
  cigarOccasion,
  lookupCigarBrand,
  matchFood,
  normalizeText,
  orderTips,
  rankPairings,
  resolveCigar,
} from './pairing'

let seq = 0
function bottle(
  name: string,
  type: string,
  flavor: Partial<FlavorTags> | null,
  avgRating: number | null = 8,
  status: Bottle['status'] = 'cabinet',
): Bottle {
  seq += 1
  return {
    id: `b${seq}`,
    name,
    producer: 'p',
    region: 'r',
    type,
    abv: 43,
    price: null,
    status,
    createdAt: '2026-01-01T00:00:00Z',
    avgRating,
    flavorProfile: flavor ? { ...EMPTY_FLAVOR, ...flavor } : null,
    noteCount: flavor ? 1 : 0,
  }
}

const cab = () => bottle('Caymus Cabernet', 'red wine', { sweet: 4, fruity: 5, oaky: 4, spicy: 2, acidity: 3, body: 5, floral: 1 }, 8)
const sauvBlanc = () => bottle('Cloudy Bay Sauvignon Blanc', 'white wine', { sweet: 2, fruity: 5, floral: 3, acidity: 5, body: 1, oaky: 1, spicy: 1 }, 7)
const lagavulin = () => bottle('Lagavulin 16', 'scotch', { sweet: 1, smoky: 5, fruity: 2, oaky: 3, spicy: 3, acidity: 1, body: 4 }, 9)
const bourbon = () => bottle('Buffalo Trace', 'bourbon', { sweet: 4, smoky: 1, fruity: 2, oaky: 4, spicy: 3, acidity: 1, body: 3 }, 8)
const coffee = () => bottle('Sumatra', 'coffee', { sweet: 2, fruity: 1, acidity: 1, body: 5, oaky: 3, smoky: 3, spicy: 2 }, 7)

describe('type taxonomy', () => {
  it('lists every type once and ends in the escape hatch', () => {
    expect(new Set(BOTTLE_TYPES).size).toBe(BOTTLE_TYPES.length)
    expect(BOTTLE_TYPES).toContain('other')
    expect(BOTTLE_TYPES).toContain('japanese whisky')
    expect(BOTTLE_TYPES).toContain('american whiskey')
    expect(TYPE_GROUPS.map((g) => g.id)).toContain('whisky')
  })

  it('treats every wine type as wine and everything else alcoholic as a spirit', () => {
    for (const t of ['red wine', 'rosé wine', 'sparkling wine', 'fortified wine']) {
      expect(isWine(t)).toBe(true)
      expect(isSpirit(t)).toBe(false)
    }
    for (const t of ['tennessee whiskey', 'cachaça', 'vermouth', 'other', 'sake']) {
      expect(isWine(t)).toBe(false)
      expect(isSpirit(t)).toBe(true)
    }
    expect(isSpirit('coffee')).toBe(false)
  })
})

describe('matchFood', () => {
  it('recognises the usual suspects', () => {
    expect(matchFood('ribeye, medium rare')?.id).toBe('steak')
    expect(matchFood('a dozen oysters on the half shell')?.id).toBe('oysters')
    expect(matchFood('Spicy Thai green curry')?.id).toBe('spicy')
    expect(matchFood('roast chicken')?.id).toBe('poultry-pork')
    expect(matchFood('al pastor tacos')?.id).toBe('mexican')
    expect(matchFood('chocolate lava cake')?.id).toBe('chocolate')
  })

  it('prefers the most specific phrase over a shorter one inside it', () => {
    expect(matchFood('blue cheese')?.id).toBe('blue-cheese')
    expect(matchFood('cheese board')?.id).toBe('cheese')
    expect(matchFood('fish and chips')?.id).toBe('seafood')
    expect(matchFood('smoked salmon')?.id).toBe('rich-fish')
    expect(matchFood('chicken tikka masala')?.id).toBe('spicy')
    expect(matchFood('beef stew')?.id).toBe('earthy')
  })

  it('matches whole words, plurals, and accents', () => {
    expect(matchFood('cheeseburger')?.id).toBe('steak')
    expect(matchFood('two scallops')?.id).toBe('seafood')
    expect(matchFood('crème brûlée')?.id).toBe('dessert')
    expect(matchFood('jamón ibérico')?.id).toBe('charcuterie')
    expect(normalizeText('  Crème-Brûlée! ')).toBe('creme brulee')
  })

  it('lets the meat name win over a bare "roast"', () => {
    expect(matchFood('roast lamb')?.id).toBe('steak')
    expect(matchFood('roast duck')?.id).toBe('duck-game')
    expect(matchFood('roast pork')?.id).toBe('poultry-pork')
    expect(matchFood('roast chicken')?.id).toBe('poultry-pork')
    expect(matchFood('roast beef')?.id).toBe('steak')
  })

  it('returns null for blank or unknown dishes', () => {
    expect(matchFood('')).toBeNull()
    expect(matchFood('   ')).toBeNull()
    expect(matchFood('xyzzy plugh')).toBeNull()
  })

  it('every occasion has a target, a why, and menu tips', () => {
    for (const o of FOOD_OCCASIONS) {
      expect(o.target).not.toBeNull()
      expect(o.why.length).toBeGreaterThan(10)
      expect(o.order.length).toBeGreaterThanOrEqual(2)
      expect(o.keywords.length).toBeGreaterThan(0)
    }
    const ids = FOOD_OCCASIONS.map((o) => o.id)
    expect(new Set(ids).size).toBe(ids.length)
  })
})

describe('rankPairings', () => {
  it('sends a big red to the steak and the Sauvignon Blanc to the oysters', () => {
    const cabinet = [cab(), sauvBlanc(), lagavulin(), bourbon()]
    const steak = rankPairings(matchFood('steak')!, cabinet)
    expect(steak[0].bottle.name).toBe('Caymus Cabernet')
    expect(steak.at(-1)!.bottle.name).toBe('Cloudy Bay Sauvignon Blanc')

    const oysters = rankPairings(matchFood('oysters')!, cabinet)
    expect(oysters[0].bottle.name).toBe('Cloudy Bay Sauvignon Blanc')
  })

  it('never recommends coffee and keeps scores in 0..1', () => {
    const picks = rankPairings(matchFood('chocolate')!, [cab(), coffee(), bourbon()])
    expect(picks.map((p) => p.bottle.type)).not.toContain('coffee')
    for (const p of picks) {
      expect(p.score).toBeGreaterThanOrEqual(0)
      expect(p.score).toBeLessThanOrEqual(1)
      expect(p.reason.length).toBeGreaterThan(0)
    }
  })

  it('ranks by rating alone for an unknown dish', () => {
    const picks = rankPairings(UNKNOWN_OCCASION, [sauvBlanc(), lagavulin(), bourbon()])
    expect(picks[0].bottle.name).toBe('Lagavulin 16')
    expect(picks[0].reason).toMatch(/rated it 9/)
    // Nothing but the rating: an `other` bottle gets no neutral-affinity leg up.
    const mixed = rankPairings(UNKNOWN_OCCASION, [
      bottle('House Sake', 'other', { sweet: 3 }, 7),
      bottle('Oban 14', 'scotch', { body: 3 }, 8),
    ])
    expect(mixed.map((p) => p.bottle.name)).toEqual(['Oban 14', 'House Sake'])
    expect(mixed.map((p) => p.score)).toEqual([0.8, 0.7])
  })

  it('survives a five-axis profile from a pre-expansion API build', () => {
    const legacy = bottle('Old Build Bourbon', 'bourbon', null, 8)
    // Only the original five axes, as an un-redeployed API would serve.
    legacy.flavorProfile = { sweet: 4, smoky: 1, fruity: 2, oaky: 4, spicy: 3 } as FlavorTags
    const picks = rankPairings(matchFood('steak')!, [legacy, sauvBlanc()])
    expect(Number.isFinite(picks[0].score)).toBe(true)
    expect(picks[0].bottle.name).toBe('Old Build Bourbon')
  })

  it('matches API-written type casing to the canon', () => {
    const steak = matchFood('steak')!
    expect(affinityFor(steak, 'Scotch')).toBe(affinityFor(steak, 'scotch'))
    expect(affinityFor(steak, ' Red Wine ')).toBe(1)
    const tips = orderTips(steak, [bottle('Shouty Cab', 'Red Wine', { body: 5 }, 9)])
    expect(tips[0].favorite?.name).toBe('Shouty Cab')
  })

  it('still places a noteless bottle on type affinity', () => {
    const picks = rankPairings(matchFood('steak')!, [
      bottle('Mystery Malbec', 'red wine', null, null),
      sauvBlanc(),
    ])
    expect(picks[0].bottle.name).toBe('Mystery Malbec')
  })

  it('caps the list and breaks ties by name', () => {
    const cabinet = Array.from({ length: 7 }, (_, i) =>
      bottle(`Bourbon ${String.fromCharCode(71 - i)}`, 'bourbon', { sweet: 4, oaky: 4, body: 3, spicy: 3 }, 8),
    )
    const picks = rankPairings(matchFood('bbq ribs')!, cabinet)
    expect(picks).toHaveLength(5)
    expect(picks[0].bottle.name).toBe('Bourbon A')
  })

  it('explains the pick in the occasion’s words', () => {
    const [top] = rankPairings(matchFood('steak')!, [cab()])
    expect(top.reason).toMatch(/classic with steak/i)
    expect(top.reason).toMatch(/body/)
  })
})

describe('affinityFor', () => {
  const steak = matchFood('steak')!
  it('uses the exact type, then its group, then zero', () => {
    expect(affinityFor(steak, 'red wine')).toBe(1)
    expect(affinityFor(steak, 'canadian whisky')).toBe(0.5) // group fallback: whisky
    expect(affinityFor(steak, 'gin')).toBe(0) // known type, deliberately unlisted
  })
  it('scores unknown and `other` types neutral', () => {
    expect(affinityFor(steak, 'other')).toBeGreaterThan(0)
    expect(affinityFor(steak, 'sake')).toBeGreaterThan(0)
  })
})

describe('orderTips', () => {
  it('anchors a suggestion to the best-rated bottle of that kind', () => {
    const tips = orderTips(matchFood('steak')!, [cab(), bourbon(), sauvBlanc()])
    expect(tips[0].favorite?.name).toBe('Caymus Cabernet')
    expect(tips[1].favorite?.name).toBe('Buffalo Trace')
    expect(tips[2].favorite).toBeNull() // no scotch in this cabinet
  })
  it('ignores bottles rated under 7', () => {
    const tips = orderTips(matchFood('steak')!, [
      bottle('Meh Merlot', 'red wine', { body: 4 }, 5),
    ])
    expect(tips[0].favorite).toBeNull()
  })
})

describe('cigars', () => {
  it('knows the big marques and infers strength from them', () => {
    expect(lookupCigarBrand('Padrón')?.strength).toBe('full')
    expect(lookupCigarBrand('Macanudo')?.wrapper).toBe('connecticut')
    expect(lookupCigarBrand('Arturo Fuente Hemingway Short Story')?.name).toMatch(/Hemingway/)
    expect(lookupCigarBrand('nothing here')).toBeNull()
    const names = CIGAR_BRANDS.map((b) => b.name)
    expect(new Set(names).size).toBeGreaterThan(50)
  })

  it('lets the drinker override, then the name, then the brand, then the default', () => {
    expect(resolveCigar({ brand: 'Padrón' }).strength).toBe('full')
    expect(resolveCigar({ brand: 'Padrón' }).strengthSource).toBe('the brand')
    expect(resolveCigar({ brand: 'Padrón', strength: 'mild' }).strength).toBe('mild')
    expect(resolveCigar({ brand: 'Padrón', strength: 'mild' }).strengthSource).toBe('you')
    expect(resolveCigar({ brand: 'Some House', line: 'Ligero Reserve' }).strength).toBe('full')
    expect(resolveCigar({ brand: 'Some House', line: 'Ligero Reserve' }).strengthSource).toBe('the name')
    expect(resolveCigar({}).strength).toBe('medium')
    expect(resolveCigar({}).strengthSource).toBe('the default')
  })

  it('reads the wrapper from the line or the brand', () => {
    expect(resolveCigar({ brand: 'Padrón', line: '1964 Anniversary Maduro Torpedo' }).wrapper).toBe('maduro')
    expect(resolveCigar({ brand: 'Liga Privada', line: 'No. 9' }).wrapper).toBe('maduro')
    expect(resolveCigar({ brand: 'Davidoff', wrapper: 'habano' }).wrapper).toBe('habano')
    expect(resolveCigar({ brand: 'Unknown' }).wrapper).toBeNull()
    // Broadleaf grown in Connecticut is a maduro leaf, not the shade wrapper.
    expect(resolveCigar({ line: 'Connecticut Broadleaf' }).wrapper).toBe('maduro')
    expect(resolveCigar({ line: 'Connecticut Shade' }).wrapper).toBe('connecticut')
  })

  it('lets a named line beat its house in the brand table', () => {
    expect(resolveCigar({ brand: 'My Father' }).strength).toBe('full')
    expect(resolveCigar({ brand: 'My Father', line: 'Flor de las Antillas' }).strength).toBe('medium')
    expect(resolveCigar({ brand: 'Drew Estate', line: 'Undercrown Shade' }).strength).toBe('mild')
  })

  it('builds a heavier target and affinity set for a full maduro than a mild Connecticut', () => {
    const full = cigarOccasion(resolveCigar({ strength: 'full', wrapper: 'maduro' }))
    const mild = cigarOccasion(resolveCigar({ strength: 'mild', wrapper: 'connecticut' }))
    expect(full.target!.body).toBeGreaterThan(mild.target!.body)
    expect(full.target!.sweet).toBeGreaterThanOrEqual(mild.target!.sweet)
    expect(mild.target!.floral).toBeGreaterThan(full.target!.floral)
    expect(affinityFor(full, 'scotch')).toBeGreaterThan(affinityFor(mild, 'scotch'))
    expect(affinityFor(mild, 'irish')).toBeGreaterThan(affinityFor(full, 'irish'))
    expect(affinityFor(full, 'white wine')).toBe(0)
    expect(full.order[0].types).toContain('rum') // wrapper-led tip first
    expect(full.why).toMatch(/cocoa/i)
  })

  it('labels a named cigar by name and an anonymous one by strength', () => {
    expect(cigarLabel(resolveCigar({ brand: 'Padrón', line: '1964' }))).toBe('Padrón 1964')
    expect(cigarLabel(resolveCigar({ strength: 'full', wrapper: 'maduro' }))).toBe('a full-bodied maduro')
    expect(cigarLabel(resolveCigar({}))).toBe('a medium cigar')
  })

  it('pours the peated Islay with a full cigar, not the Sauvignon Blanc', () => {
    const occasion = cigarOccasion(resolveCigar({ brand: 'Padrón' }))
    const picks = rankPairings(occasion, [sauvBlanc(), lagavulin(), bourbon(), cab()])
    expect(picks[0].bottle.name).toBe('Lagavulin 16')
    expect(picks.at(-1)!.bottle.name).toBe('Cloudy Bay Sauvignon Blanc')
    expect(picks.at(-1)!.reason).toMatch(/outside pick/i)
  })
})

describe('bottle status', () => {
  it('rankPairings pours only from the shelf', () => {
    const gone = bottle('Empty Ardbeg', 'scotch', { smoky: 5, body: 4, oaky: 3 }, 9, 'finished')
    const bar = bottle('Bar Hibiki', 'japanese whisky', { sweet: 3, floral: 3, body: 3 }, 9, 'tasted')
    const names = rankPairings(matchFood('steak')!, [gone, bar, bourbon(), cab()]).map(
      (p) => p.bottle.name,
    )
    expect(names).toContain('Buffalo Trace')
    expect(names).toContain('Caymus Cabernet')
    expect(names).not.toContain('Empty Ardbeg')
    expect(names).not.toContain('Bar Hibiki')
  })

  it('orderTips still anchor on a favorite you only tasted elsewhere', () => {
    const bar = bottle('Bar Caymus', 'red wine', { fruity: 5, body: 5 }, 9, 'tasted')
    const tips = orderTips(matchFood('steak')!, [bar])
    expect(tips[0].favorite?.name).toBe('Bar Caymus')
  })
})
