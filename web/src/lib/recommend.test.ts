import { describe, expect, it } from 'vitest'
import { rankBySimilarity } from './recommend'
import type { Bottle, FlavorTags } from './types'
import { EMPTY_FLAVOR } from './types'

let seq = 0
function bottle(
  type: string,
  region: string,
  flavor: FlavorTags | null,
  avgRating: number | null = 8,
): Bottle {
  seq += 1
  return {
    id: `b${seq}`,
    name: `Bottle ${seq}`,
    producer: 'p',
    region,
    type,
    abv: 43,
    price: null,
    createdAt: '2026-01-01T00:00:00Z',
    avgRating,
    flavorProfile: flavor,
    noteCount: flavor ? 1 : 0,
  }
}

const smoky: FlavorTags = {
  ...EMPTY_FLAVOR,
  sweet: 1,
  smoky: 5,
  fruity: 2,
  oaky: 3,
  spicy: 3,
  body: 4,
}
const sweet: FlavorTags = {
  ...EMPTY_FLAVOR,
  sweet: 5,
  fruity: 4,
  oaky: 3,
  spicy: 1,
  acidity: 2,
}

describe('rankBySimilarity', () => {
  it('drops the target itself from the ranking', () => {
    const target = bottle('scotch', 'Islay', smoky)
    const ranked = rankBySimilarity(target, [target, bottle('bourbon', 'KY', sweet)])
    expect(ranked.every((r) => r.bottle.id !== target.id)).toBe(true)
  })

  it('ranks a flavor-similar bottle above a dissimilar one', () => {
    const target = bottle('scotch', 'Islay', smoky)
    const alike = bottle('scotch', 'Islay', { ...smoky })
    const different = bottle('white wine', 'Loire', sweet)
    const ranked = rankBySimilarity(target, [alike, different])
    expect(ranked[0].bottle.id).toBe(alike.id)
    expect(ranked[0].score).toBeGreaterThan(ranked[1].score)
  })

  it('keeps scores within 0..1', () => {
    const target = bottle('scotch', 'Islay', smoky)
    const ranked = rankBySimilarity(target, [
      bottle('scotch', 'Islay', smoky),
      bottle('rye', 'Vermont', sweet),
      bottle('bourbon', 'KY', null),
    ])
    for (const r of ranked) {
      expect(r.score).toBeGreaterThanOrEqual(0)
      expect(r.score).toBeLessThanOrEqual(1)
    }
  })

  it('always attaches a human reason', () => {
    const target = bottle('scotch', 'Islay', smoky)
    const ranked = rankBySimilarity(target, [bottle('scotch', 'Islay', smoky)])
    expect(ranked[0].reason.length).toBeGreaterThan(0)
    expect(ranked[0].reason).toMatch(/scotch|Islay|character|profile/i)
  })

  it('still ranks bottles that lack a flavor profile via metadata', () => {
    const target = bottle('bourbon', 'Kentucky', sweet)
    const noProfile = bottle('bourbon', 'Kentucky', null)
    const ranked = rankBySimilarity(target, [noProfile])
    expect(ranked[0].score).toBeGreaterThan(0)
  })
})
