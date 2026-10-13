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

  it('deleteBottle removes the bottle and its notes; a second delete 404s', async () => {
    const api = makeMockApi()
    await api.deleteBottle('b-lagavulin-16', 'demo-token')
    await expect(api.getBottle('b-lagavulin-16')).rejects.toMatchObject({ status: 404 })
    expect((await api.listBottles()).some((b) => b.id === 'b-lagavulin-16')).toBe(false)
    await expect(api.deleteBottle('b-lagavulin-16', 'demo-token')).rejects.toMatchObject({
      status: 404,
    })
    await expect(api.deleteBottle('b-ardbeg-10', '')).rejects.toMatchObject({ status: 401 })
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

  it('skips narration when the family pool is too small to mean anything', async () => {
    const api = makeMockApi()
    // Only 3 coffees seeded (2 candidates) — below the narration gate, even
    // though this bottle is in the NARRATED demo set.
    const result = await api.getRecommendations('c-yirgacheffe')
    expect(result.narration).toBeNull()
    expect(result.basis).not.toBe('narrated')
  })

  it('narration renders bottle names in markdown bold for the panel to style', async () => {
    const api = makeMockApi()
    const result = await api.getRecommendations('b-lagavulin-16')
    expect(result.narration).toMatch(/\*\*[^*]+\*\*/)
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

  it('canonicalizes roast on create ("Light" -> "light")', async () => {
    const api = makeMockApi()
    const made = await api.createBottle(
      {
        name: 'Mt Ijen', producer: 'Mango Tree', region: 'Indonesia',
        type: 'coffee', abv: 0, roast: 'Light',
      },
      't',
    )
    expect(made.roast).toBe('light')
  })

  it('stores brew on a note and lets its author edit it', async () => {
    const api = makeMockApi()
    const note = await api.addNote(
      'c-huila',
      {
        nose: 'cocoa', palate: 'toffee', finish: 'clean', rating: 8,
        flavorTags: { ...EMPTY_FLAVOR, sweet: 4 },
        brew: { grinder: 'Comandante C40', method: 'AeroPress', time: '1:45' },
      },
      'my-token',
    )
    expect(note.brew?.grinder).toBe('Comandante C40')

    const edited = await api.updateNote(
      'c-huila',
      note.id,
      {
        nose: 'cocoa', palate: 'toffee, deeper', finish: 'clean', rating: 9,
        flavorTags: { ...EMPTY_FLAVOR, sweet: 5 },
        brew: { grinder: 'Comandante C40', method: 'V60 pour over' },
      },
      'my-token',
    )
    expect(edited.rating).toBe(9)
    expect(edited.brew?.method).toBe('V60 pour over')
    expect(edited.updatedAt).toBeTruthy()
  })

  it("rejects editing someone else's note with 403", async () => {
    const api = makeMockApi()
    const note = await api.addNote(
      'c-huila',
      {
        nose: 'n', palate: 'p', finish: 'f', rating: 7,
        flavorTags: { ...EMPTY_FLAVOR, sweet: 2 },
      },
      'author-token',
    )
    await expect(
      api.updateNote(
        'c-huila',
        note.id,
        {
          nose: 'hijack', palate: 'p', finish: 'f', rating: 1,
          flavorTags: { ...EMPTY_FLAVOR },
        },
        'other-token',
      ),
    ).rejects.toMatchObject({ status: 403 })
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

describe('mock API — bottle status', () => {
  it('seeds a finished bottle and a bar pour beside the shelf', async () => {
    const bottles = await makeMockApi().listBottles()
    const statusOf = (id: string) => bottles.find((b) => b.id === id)?.status
    expect(statusOf('b-ardbeg-10')).toBe('finished')
    expect(statusOf('b-hibiki-harmony')).toBe('tasted')
    expect(bottles.filter((b) => b.status === 'cabinet').length).toBe(bottles.length - 2)
  })

  it('createBottle defaults to the cabinet and keeps a given status; updateBottle moves it', async () => {
    const api = makeMockApi()
    const shelf = await api.createBottle(
      { name: 'Shelf', producer: 'p', region: 'r', type: 'rye', abv: 45 },
      't',
    )
    expect(shelf.status).toBe('cabinet')
    const bar = await api.createBottle(
      { name: 'Bar pour', producer: 'p', region: 'r', type: 'rye', abv: 45, status: 'tasted' },
      't',
    )
    expect(bar.status).toBe('tasted')
    expect((await api.updateBottle(shelf.id, { status: 'finished' }, 't')).status).toBe('finished')
    expect((await api.getBottle(shelf.id)).bottle.status).toBe('finished')
    // An edit that doesn't mention the status leaves it alone.
    expect((await api.updateBottle(bar.id, { price: 60 }, 't')).status).toBe('tasted')
  })

  it('pairingNarration pours only from the shelf', async () => {
    const api = makeMockApi()
    const offShelf = await api.pairingNarration(
      { kind: 'food', text: 'oysters', candidateIds: ['b-hibiki-harmony', 'b-ardbeg-10'] },
      't',
    )
    expect(offShelf.narration).toMatch(/nothing in the cabinet/)
    const mixed = await api.pairingNarration(
      { kind: 'food', text: 'oysters', candidateIds: ['b-hibiki-harmony', 'b-lagavulin-16'] },
      't',
    )
    expect(mixed.narration).toMatch(/\*\*Lagavulin 16\*\*/)
  })
})
