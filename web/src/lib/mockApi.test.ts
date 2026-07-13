import { describe, expect, it } from 'vitest'
import { makeMockApi, __seedCount } from './mockApi'
import { ApiError } from './api'
import { EMPTY_FLAVOR } from './types'

describe('mock API — contract', () => {
  it('seeds a full cabinet and coffee bar with varied types', async () => {
    const api = makeMockApi()
    const bottles = await api.listBottles()
    expect(bottles.length).toBe(__seedCount)
    expect(bottles.length).toBeGreaterThanOrEqual(12)
    const types = new Set(bottles.map((b) => b.type))
    for (const t of [
      'scotch',
      'bourbon',
      'rye',
      'red wine',
      'tequila',
      'mezcal',
      'rum',
      'gin',
      'absinthe',
      'cognac',
      'coffee',
    ]) {
      expect(types.has(t)).toBe(true)
    }
  })

  it('every seeded bottle has notes, a rating, and a profile', async () => {
    const api = makeMockApi()
    for (const b of await api.listBottles()) {
      expect(b.noteCount).toBeGreaterThanOrEqual(1)
      expect(b.avgRating).not.toBeNull()
      expect(b.flavorProfile).not.toBeNull()
    }
  })

  it('getBottle returns the bottle + its notes', async () => {
    const api = makeMockApi()
    const { bottle, notes } = await api.getBottle('b-lagavulin-16')
    expect(bottle.name).toBe('Lagavulin 16')
    expect(notes.length).toBe(bottle.noteCount)
    expect(notes.every((n) => n.bottleId === bottle.id)).toBe(true)
  })

  it('getBottle 404s for an unknown id', async () => {
    const api = makeMockApi()
    await expect(api.getBottle('nope')).rejects.toBeInstanceOf(ApiError)
  })

  it('writes require a token', async () => {
    const api = makeMockApi()
    await expect(
      api.createBottle(
        { name: 'x', producer: 'y', region: 'z', type: 'rye', abv: 40 },
        '',
      ),
    ).rejects.toMatchObject({ status: 401 })
  })

  it('createBottle adds a bottle visible in the list', async () => {
    const api = makeMockApi()
    const before = (await api.listBottles()).length
    const made = await api.createBottle(
      {
        name: 'Test Cask',
        producer: 'Test Co',
        region: 'Nowhere',
        type: 'bourbon',
        abv: 50,
        price: 42,
      },
      'demo-token',
    )
    expect(made.id).toBeTruthy()
    expect(made.noteCount).toBe(0)
    expect(made.flavorProfile).toBeNull()
    const after = await api.listBottles()
    expect(after.length).toBe(before + 1)
    expect(after.some((b) => b.id === made.id)).toBe(true)
  })

  it('addNote recomputes avgRating and flavor profile', async () => {
    const api = makeMockApi()
    const made = await api.createBottle(
      { name: 'Blank', producer: 'p', region: 'r', type: 'rye', abv: 45 },
      't',
    )
    await api.addNote(
      made.id,
      {
        nose: 'n',
        palate: 'p',
        finish: 'f',
        rating: 8,
        flavorTags: { ...EMPTY_FLAVOR, spicy: 5, oaky: 3 },
      },
      't',
    )
    const { bottle, notes } = await api.getBottle(made.id)
    expect(notes.length).toBe(1)
    expect(bottle.avgRating).toBe(8)
    expect(bottle.noteCount).toBe(1)
    expect(bottle.flavorProfile?.spicy).toBe(5)
  })

  it('recommendations exclude the target and are ranked 0..1', async () => {
    const api = makeMockApi()
    const result = await api.getRecommendations('b-lagavulin-16')
    expect(result.recommendations.every((r) => r.bottleId !== 'b-lagavulin-16')).toBe(
      true,
    )
    const scores = result.recommendations.map((r) => r.score)
    for (const s of scores) {
      expect(s).toBeGreaterThanOrEqual(0)
      expect(s).toBeLessThanOrEqual(1)
    }
    // sorted descending
    expect([...scores].sort((a, b) => b - a)).toEqual(scores)
  })

  it('a smoky Islay scotch recommends another smoky Islay scotch first', async () => {
    const api = makeMockApi()
    const result = await api.getRecommendations('b-lagavulin-16')
    expect(result.recommendations[0]?.bottleId).toBe('b-ardbeg-10')
  })

  it('surfaces a narrated basis with prose for a narrated bottle', async () => {
    const api = makeMockApi()
    const result = await api.getRecommendations('b-lagavulin-16')
    expect(result.basis).toBe('narrated')
    expect(result.narration).toBeTruthy()
    expect(result.degraded).toBe(false)
  })

  it('surfaces a degraded result for the flagged bottle', async () => {
    const api = makeMockApi()
    const result = await api.getRecommendations('b-cloudy-bay-sb')
    expect(result.degraded).toBe(true)
    expect(result.narration).toBeNull()
  })

  it('narrates a coffee target too', async () => {
    const api = makeMockApi()
    const result = await api.getRecommendations('c-yirgacheffe')
    expect(result.basis).toBe('narrated')
    expect(result.narration).toBeTruthy()
  })

  it('surfaces a text basis for a multi-note, non-narrated bottle', async () => {
    const api = makeMockApi()
    // Rittenhouse has 2 notes and is neither narrated nor degraded.
    const result = await api.getRecommendations('b-rittenhouse-rye')
    expect(result.basis).toBe('text')
    expect(result.narration).toBeNull()
    expect(result.degraded).toBe(false)
  })

  it('keeps main recommendations in-family for a coffee target', async () => {
    const api = makeMockApi()
    const bottles = await api.listBottles()
    const typeById = new Map(bottles.map((b) => [b.id, b.type]))
    const result = await api.getRecommendations('c-sumatra')
    for (const r of result.recommendations) {
      expect(typeById.get(r.bottleId)).toBe('coffee')
    }
  })

  it('bridges coffee -> cabinet via crossFamily', async () => {
    const api = makeMockApi()
    const bottles = await api.listBottles()
    const typeById = new Map(bottles.map((b) => [b.id, b.type]))
    const result = await api.getRecommendations('c-sumatra')
    expect(result.crossFamily.length).toBeGreaterThan(0)
    for (const r of result.crossFamily) {
      expect(typeById.get(r.bottleId)).not.toBe('coffee')
    }
  })

  it('bridges cabinet -> coffee via crossFamily', async () => {
    const api = makeMockApi()
    const bottles = await api.listBottles()
    const typeById = new Map(bottles.map((b) => [b.id, b.type]))
    const result = await api.getRecommendations('b-lagavulin-16')
    expect(result.crossFamily.length).toBeGreaterThan(0)
    for (const r of result.crossFamily) {
      expect(typeById.get(r.bottleId)).toBe('coffee')
    }
  })

  it('per-type fields survive create and update round-trips', async () => {
    const api = makeMockApi()
    const made = await api.createBottle(
      {
        name: 'Kenya AA',
        producer: 'Roaster',
        region: 'Nyeri, Kenya',
        type: 'coffee',
        abv: 0,
        roast: 'light',
        process: 'washed',
      },
      't',
    )
    expect(made.roast).toBe('light')
    expect(made.process).toBe('washed')
    const updated = await api.updateBottle(
      made.id,
      { roast: 'medium', process: null },
      't',
    )
    expect(updated.roast).toBe('medium')
    expect(updated.process).toBeUndefined()
  })

  it('health check is ok', async () => {
    const api = makeMockApi()
    expect(await api.health()).toEqual({ ok: true })
  })
})
