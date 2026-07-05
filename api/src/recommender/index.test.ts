import { describe, expect, it, vi } from 'vitest'
import type { BottleItem, FlavorTags, NoteItem } from '../types'
import { rankStructured, rankText, recommend, type CorpusBottle } from './index'

let seq = 0
function bottle(
  id: string,
  region: string,
  type: string,
  abv: number,
): BottleItem {
  return {
    pk: `BOTTLE#${id}`,
    sk: 'META',
    type: 'bottle',
    id,
    name: `Bottle ${id}`,
    producer: 'P',
    region,
    type_: type,
    abv,
    price: null,
    createdAt: '2026-01-01T00:00:00.000Z',
  }
}

function note(
  bottleId: string,
  rating: number,
  flavor: FlavorTags,
  embedding?: number[],
): NoteItem {
  seq += 1
  return {
    pk: `BOTTLE#${bottleId}`,
    sk: `NOTE#2026-01-0${seq}#n${seq}`,
    type: 'note',
    id: `n${seq}`,
    bottleId,
    nose: 'n',
    palate: 'p',
    finish: 'f',
    rating,
    flavorTags: flavor,
    createdAt: `2026-01-0${seq}T00:00:00.000Z`,
    embedding,
  }
}

const F = (
  sweet: number,
  smoky: number,
  fruity: number,
  oaky: number,
  spicy: number,
): FlavorTags => ({ sweet, smoky, fruity, oaky, spicy })

describe('rankStructured', () => {
  it('ranks a lookalike above a dissimilar bottle', () => {
    const corpus: CorpusBottle[] = [
      { item: bottle('target', 'Islay', 'scotch', 46), notes: [note('target', 8, F(1, 5, 1, 3, 2))] },
      { item: bottle('twin', 'Islay', 'scotch', 46), notes: [note('twin', 5, F(1, 5, 1, 3, 2))] },
      { item: bottle('other', 'Napa', 'wine', 13), notes: [note('other', 5, F(4, 0, 5, 1, 0))] },
    ]
    const ranked = rankStructured('target', corpus)
    expect(ranked[0].bottleId).toBe('twin')
    expect(ranked.map((r) => r.bottleId)).not.toContain('target') // never self
    expect(ranked[0].score).toBeGreaterThan(ranked[1].score)
  })

  it('returns [] when the target is not in the corpus', () => {
    expect(rankStructured('nope', [])).toEqual([])
  })

  it('caps output at 5 recommendations', () => {
    const corpus: CorpusBottle[] = []
    for (let i = 0; i < 8; i++) {
      corpus.push({ item: bottle(`b${i}`, 'Islay', 'scotch', 46), notes: [] })
    }
    const ranked = rankStructured('b0', corpus)
    expect(ranked.length).toBe(5)
  })
})

describe('rankText', () => {
  it('ranks by note-embedding similarity and excludes un-embedded bottles', () => {
    const corpus: CorpusBottle[] = [
      { item: bottle('target', 'Islay', 'scotch', 46), notes: [note('target', 8, F(1, 5, 1, 3, 2), [1, 0, 0])] },
      { item: bottle('close', 'Speyside', 'scotch', 40), notes: [note('close', 7, F(1, 5, 1, 3, 2), [0.9, 0.1, 0])] },
      { item: bottle('far', 'Napa', 'wine', 13), notes: [note('far', 6, F(4, 0, 5, 1, 0), [0, 0, 1])] },
      { item: bottle('noembed', 'Islay', 'scotch', 46), notes: [note('noembed', 6, F(1, 5, 1, 3, 2))] },
    ]
    const ranked = rankText('target', corpus)
    expect(ranked).not.toBeNull()
    expect(ranked!.map((r) => r.bottleId)).toEqual(['close', 'far'])
    expect(ranked!.map((r) => r.bottleId)).not.toContain('noembed')
  })

  it('returns null when the target has no embedded notes', () => {
    const corpus: CorpusBottle[] = [
      { item: bottle('target', 'Islay', 'scotch', 46), notes: [note('target', 8, F(1, 5, 1, 3, 2))] },
      { item: bottle('other', 'Islay', 'scotch', 46), notes: [note('other', 8, F(1, 5, 1, 3, 2), [1, 0])] },
    ]
    expect(rankText('target', corpus)).toBeNull()
  })
})

describe('recommend — degradation chain', () => {
  const structuredOnly: CorpusBottle[] = [
    { item: bottle('t', 'Islay', 'scotch', 46), notes: [note('t', 8, F(1, 5, 1, 3, 2))] },
    { item: bottle('u', 'Islay', 'scotch', 46), notes: [note('u', 7, F(1, 5, 1, 3, 2))] },
  ]

  it('layer 1: structured only, no narrate dep -> basis=structured, not degraded', async () => {
    const res = await recommend('t', structuredOnly)
    expect(res.basis).toBe('structured')
    expect(res.degraded).toBe(false)
    expect(res.narration).toBeNull()
    expect(res.recommendations.length).toBeGreaterThan(0)
  })

  it('layer 3: narrate succeeds over text vectors -> basis=narrated, not degraded', async () => {
    const withEmbeddings: CorpusBottle[] = [
      { item: bottle('t', 'Islay', 'scotch', 46), notes: [note('t', 8, F(1, 5, 1, 3, 2), [1, 0, 0])] },
      { item: bottle('u', 'Islay', 'scotch', 46), notes: [note('u', 7, F(1, 5, 1, 3, 2), [0.9, 0.1, 0])] },
    ]
    const narrate = vi.fn().mockResolvedValue('Try Bottle u — same smoky Islay core.')
    const res = await recommend('t', withEmbeddings, { narrate })
    expect(narrate).toHaveBeenCalledOnce()
    expect(res.basis).toBe('narrated')
    expect(res.degraded).toBe(false)
    expect(res.narration).toContain('Bottle u')
  })

  it('narrated over structured-only base still narrates but flags degraded (no text vectors)', async () => {
    const narrate = vi.fn().mockResolvedValue('Structured pick.')
    const res = await recommend('t', structuredOnly, { narrate })
    expect(res.basis).toBe('narrated')
    // Bedrock narration worked, but the underlying ranking fell back to
    // structured because no embeddings existed -> degraded.
    expect(res.degraded).toBe(true)
  })

  it('narrate throws (Bedrock down) -> degrades to base layer, degraded=true', async () => {
    const withEmbeddings: CorpusBottle[] = [
      { item: bottle('t', 'Islay', 'scotch', 46), notes: [note('t', 8, F(1, 5, 1, 3, 2), [1, 0, 0])] },
      { item: bottle('u', 'Islay', 'scotch', 46), notes: [note('u', 7, F(1, 5, 1, 3, 2), [0.9, 0.1, 0])] },
    ]
    const narrate = vi.fn().mockRejectedValue(new Error('AccessDeniedException'))
    const res = await recommend('t', withEmbeddings, { narrate })
    expect(res.basis).toBe('text') // fell back to the base ranking layer
    expect(res.degraded).toBe(true)
    expect(res.narration).toBeNull()
  })

  it('empty/singleton corpus -> no recommendations, not degraded', async () => {
    const solo: CorpusBottle[] = [
      { item: bottle('t', 'Islay', 'scotch', 46), notes: [] },
    ]
    const res = await recommend('t', solo)
    expect(res.recommendations).toEqual([])
    expect(res.degraded).toBe(false)
  })
})
