import { describe, expect, it } from 'vitest'
import type { BottleDetail, FlavorTags, TastingNote } from './types'
import { EMPTY_FLAVOR } from './types'
import {
  DETAIL_CONCURRENCY,
  averageRating,
  collectNotes,
  detailsFrom,
  gearStats,
  loadCorpus,
  mapLimit,
  tasteProfile,
  topAxes,
} from './hub'
import { ApiError, type DramApi } from './api'
import { rankByTasteProfile } from './recommend'

let seq = 0
function note(over: Partial<TastingNote> = {}): TastingNote {
  seq += 1
  return {
    id: `n${seq}`,
    bottleId: 'b1',
    nose: 'n',
    palate: 'p',
    finish: 'f',
    rating: 8,
    flavorTags: { ...EMPTY_FLAVOR },
    createdAt: `2026-06-0${(seq % 9) + 1}T00:00:00.000Z`,
    ...over,
  }
}

function detail(
  id: string,
  name: string,
  type: string,
  notes: TastingNote[],
  flavorProfile: FlavorTags | null = null,
): BottleDetail {
  return {
    bottle: {
      id,
      name,
      producer: 'p',
      region: 'r',
      type,
      abv: 40,
      price: null,
      status: 'cabinet',
      createdAt: '2026-01-01T00:00:00.000Z',
      avgRating: null,
      flavorProfile,
      noteCount: notes.length,
    },
    notes,
  }
}

describe('collectNotes', () => {
  it('flattens across bottles, joins name/type, newest first', () => {
    const details = [
      detail('b1', 'Lagavulin 16', 'scotch', [
        note({ id: 'old', createdAt: '2026-05-01T00:00:00.000Z' }),
      ]),
      detail('c1', 'Yirgacheffe', 'coffee', [
        note({ id: 'new', createdAt: '2026-06-01T00:00:00.000Z' }),
      ]),
    ]
    const all = collectNotes(details)
    expect(all.map((n) => n.id)).toEqual(['new', 'old'])
    expect(all[0].bottleName).toBe('Yirgacheffe')
    expect(all[0].bottleType).toBe('coffee')
    expect(all[1].bottleName).toBe('Lagavulin 16')
  })
})

describe('tasteProfile', () => {
  it('is null with no notes', () => {
    expect(tasteProfile([])).toBeNull()
  })

  it('averages each axis across notes, to 1dp', () => {
    const profile = tasteProfile([
      note({ flavorTags: { ...EMPTY_FLAVOR, sweet: 4, smoky: 1 } }),
      note({ flavorTags: { ...EMPTY_FLAVOR, sweet: 3, smoky: 0 } }),
    ])
    expect(profile).toMatchObject({ sweet: 3.5, smoky: 0.5, floral: 0 })
  })
})

describe('topAxes', () => {
  it('returns the strongest non-zero axes, descending', () => {
    const p = { ...EMPTY_FLAVOR, sweet: 4, acidity: 5, body: 2 }
    expect(topAxes(p)).toEqual(['acidity', 'sweet'])
  })

  it('is empty for an all-zero profile', () => {
    expect(topAxes({ ...EMPTY_FLAVOR })).toEqual([])
  })
})

describe('averageRating', () => {
  it('averages to 1dp and handles empty', () => {
    expect(averageRating([])).toBeNull()
    expect(averageRating([note({ rating: 9 }), note({ rating: 8 })])).toBe(8.5)
  })
})

describe('gearStats', () => {
  it('counts grinders and methods from brew metadata, most-used first', () => {
    const details = [
      detail('c1', 'Yirgacheffe', 'coffee', [
        note({ brew: { grinder: 'Fellow Ode Gen 2', method: 'V60 pour over' } }),
        note({ brew: { grinder: 'Fellow Ode Gen 2', method: 'AeroPress' } }),
      ]),
      detail('c2', 'Huila', 'coffee', [
        note({ brew: { grinder: 'Baratza Encore', method: 'V60 pour over' } }),
        note({}), // no brew — ignored
      ]),
    ]
    const stats = gearStats(collectNotes(details))
    expect(stats.grinders).toEqual([
      ['Fellow Ode Gen 2', 2],
      ['Baratza Encore', 1],
    ])
    expect(stats.methods[0]).toEqual(['V60 pour over', 2])
  })

  it('is empty when no notes carry brew data', () => {
    const stats = gearStats(collectNotes([detail('b1', 'Lagavulin', 'scotch', [note({})])]))
    expect(stats.grinders).toEqual([])
    expect(stats.methods).toEqual([])
  })
})

describe('rankByTasteProfile', () => {
  const smokyTaste: FlavorTags = { ...EMPTY_FLAVOR, smoky: 5, body: 4, oaky: 3 }

  it('ranks the taste-alike first and excludes profileless bottles', () => {
    const alike = detail('a', 'Ardbeg', 'scotch', [], {
      ...EMPTY_FLAVOR, smoky: 5, body: 3, oaky: 3,
    }).bottle
    const far = detail('f', 'Cloudy Bay', 'white wine', [], {
      ...EMPTY_FLAVOR, fruity: 5, acidity: 5,
    }).bottle
    const noProfile = detail('n', 'Empty', 'rum', []).bottle
    const ranked = rankByTasteProfile(smokyTaste, [far, noProfile, alike])
    expect(ranked.map((r) => r.bottle.id)).toEqual(['a', 'f'])
    expect(ranked[0].score).toBeGreaterThan(ranked[1].score)
  })

  it('keeps scores in 0..1 and attaches a reason', () => {
    const b = detail('a', 'A', 'scotch', [], {
      ...EMPTY_FLAVOR, smoky: 4, body: 4,
    }).bottle
    const [r] = rankByTasteProfile(smokyTaste, [b])
    expect(r.score).toBeGreaterThanOrEqual(0)
    expect(r.score).toBeLessThanOrEqual(1)
    expect(r.reason).toMatch(/smoky|body|palate/i)
  })
})

describe('detailsFrom', () => {
  it('joins notes to bottles, newest first, and drops orphans', () => {
    const a = detail('a', 'A', 'scotch', [])
    const b = detail('b', 'B', 'scotch', [])
    const out = detailsFrom(
      [a.bottle, b.bottle],
      [
        note({ id: 'old', bottleId: 'a', createdAt: '2026-01-01T00:00:00.000Z' }),
        note({ id: 'orphan', bottleId: 'gone' }),
        note({ id: 'new', bottleId: 'a', createdAt: '2026-02-01T00:00:00.000Z' }),
      ],
    )
    expect(out.map((d) => d.bottle.id)).toEqual(['a', 'b'])
    expect(out[0].notes.map((n) => n.id)).toEqual(['new', 'old'])
    expect(out[1].notes).toEqual([])
  })
})

describe('mapLimit', () => {
  it('keeps order and never exceeds the limit in flight', async () => {
    let inFlight = 0
    let peak = 0
    const out = await mapLimit([5, 1, 4, 2, 3, 6, 7], 3, async (n) => {
      inFlight += 1
      peak = Math.max(peak, inFlight)
      await new Promise((r) => setTimeout(r, n))
      inFlight -= 1
      return n * 10
    })
    expect(out).toEqual([50, 10, 40, 20, 30, 60, 70])
    expect(peak).toBe(3)
  })
})

describe('loadCorpus', () => {
  const bottles = [detail('a', 'A', 'scotch', []).bottle, detail('b', 'B', 'coffee', []).bottle]
  function fakeApi(over: Partial<DramApi>): DramApi & { getBottleCalls: number; peak: number } {
    let inFlight = 0
    const api = {
      getBottleCalls: 0,
      peak: 0,
      listBottles: async () => bottles,
      listNotes: async () => [note({ bottleId: 'b' })],
      getBottle: async (id: string) => {
        api.getBottleCalls += 1
        inFlight += 1
        api.peak = Math.max(api.peak, inFlight)
        await new Promise((r) => setTimeout(r, 2))
        inFlight -= 1
        return { bottle: bottles.find((b) => b.id === id) ?? { ...bottles[0], id }, notes: [] }
      },
      ...over,
    } as DramApi & { getBottleCalls: number; peak: number }
    return api
  }

  it('reads bottles and notes, never a bottle at a time', async () => {
    const api = fakeApi({})
    const out = await loadCorpus(api)
    expect(out.map((d) => d.notes.length)).toEqual([0, 1])
    expect(api.getBottleCalls).toBe(0)
  })

  it('falls back to a few reads at a time when GET /notes is not deployed', async () => {
    const api = fakeApi({
      listBottles: async () => Array.from({ length: 9 }, (_, i) => detail(`b${i}`, 'B', 'rye', []).bottle),
      listNotes: async () => {
        throw new ApiError(404, 'Not Found')
      },
    })
    const out = await loadCorpus(api)
    expect(out).toHaveLength(9)
    expect(api.getBottleCalls).toBe(9)
    expect(api.peak).toBeLessThanOrEqual(DETAIL_CONCURRENCY)
    expect(api.peak).toBeGreaterThan(1)
  })

  it('surfaces any other failure', async () => {
    const api = fakeApi({
      listNotes: async () => {
        throw new ApiError(503, 'Service Unavailable')
      },
    })
    await expect(loadCorpus(api)).rejects.toMatchObject({ status: 503 })
  })
})
