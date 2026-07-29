import { describe, expect, it, vi } from 'vitest'
import type { BottleItem, FlavorTags, NoteItem } from '../types'
import {
  rankCross,
  rankStructured,
  rankText,
  recommend,
  type CorpusBottle,
} from './index'

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
  flavor: Partial<FlavorTags>,
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

/** A core-five-axes tag set, as a pre-expansion note would carry. */
const F = (
  sweet: number,
  smoky: number,
  fruity: number,
  oaky: number,
  spicy: number,
): Partial<FlavorTags> => ({ sweet, smoky, fruity, oaky, spicy })

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
  // Narration needs MIN_NARRATE_POOL (5) same-family candidates; these
  // corpora carry the target plus five peers so layer 3 is reachable.
  const structuredOnly: CorpusBottle[] = [
    { item: bottle('t', 'Islay', 'scotch', 46), notes: [note('t', 8, F(1, 5, 1, 3, 2))] },
    ...['u1', 'u2', 'u3', 'u4', 'u5'].map((id) => ({
      item: bottle(id, 'Islay', 'scotch', 46),
      notes: [note(id, 7, F(1, 5, 1, 3, 2))],
    })),
  ]
  const withEmbeddings: CorpusBottle[] = [
    { item: bottle('t', 'Islay', 'scotch', 46), notes: [note('t', 8, F(1, 5, 1, 3, 2), [1, 0, 0])] },
    ...['u1', 'u2', 'u3', 'u4', 'u5'].map((id, i) => ({
      item: bottle(id, 'Islay', 'scotch', 46),
      notes: [note(id, 7, F(1, 5, 1, 3, 2), [0.9 - i * 0.1, 0.1 + i * 0.1, 0])],
    })),
  ]

  it('layer 1: structured only, no narrate dep -> basis=structured, not degraded', async () => {
    const res = await recommend('t', structuredOnly)
    expect(res.basis).toBe('structured')
    expect(res.degraded).toBe(false)
    expect(res.narration).toBeNull()
    expect(res.recommendations.length).toBeGreaterThan(0)
  })

  it('layer 3: narrate succeeds over text vectors -> basis=narrated, not degraded', async () => {
    const narrate = vi.fn().mockResolvedValue('Try Bottle u1 — same smoky Islay core.')
    const res = await recommend('t', withEmbeddings, { narrate })
    expect(narrate).toHaveBeenCalledOnce()
    expect(res.basis).toBe('narrated')
    expect(res.degraded).toBe(false)
    expect(res.narration).toContain('Bottle u1')
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
    const narrate = vi.fn().mockRejectedValue(new Error('AccessDeniedException'))
    const res = await recommend('t', withEmbeddings, { narrate })
    expect(res.basis).toBe('text') // fell back to the base ranking layer
    expect(res.degraded).toBe(true)
    expect(res.narration).toBeNull()
  })

  it('skips narration entirely when the family pool is small (noise gate)', async () => {
    const tiny: CorpusBottle[] = [
      { item: bottle('t', 'Islay', 'scotch', 46), notes: [note('t', 8, F(1, 5, 1, 3, 2))] },
      { item: bottle('u', 'Islay', 'scotch', 46), notes: [note('u', 7, F(1, 5, 1, 3, 2))] },
    ]
    const narrate = vi.fn().mockResolvedValue('should never run')
    const res = await recommend('t', tiny, { narrate })
    expect(narrate).not.toHaveBeenCalled()
    expect(res.basis).toBe('structured')
    expect(res.narration).toBeNull()
    // A deliberate skip is not a failure.
    expect(res.degraded).toBe(false)
  })

  it('empty/singleton corpus -> no recommendations, not degraded', async () => {
    const solo: CorpusBottle[] = [
      { item: bottle('t', 'Islay', 'scotch', 46), notes: [] },
    ]
    const res = await recommend('t', solo)
    expect(res.recommendations).toEqual([])
    expect(res.crossFamily).toEqual([])
    expect(res.degraded).toBe(false)
  })
})

describe('family gating + crossFamily', () => {
  const smokyTags = F(1, 5, 1, 3, 2)

  const mixedCorpus = (): CorpusBottle[] => [
    { item: bottle('target', 'Islay', 'scotch', 46), notes: [note('target', 8, smokyTags)] },
    { item: bottle('twin', 'Islay', 'scotch', 46), notes: [note('twin', 7, smokyTags)] },
    // A coffee with the *identical* flavor profile — without gating it would
    // outrank everything.
    { item: bottle('brew', 'Sumatra', 'coffee', 0), notes: [note('brew', 8, smokyTags)] },
  ]

  it('main recommendations never cross families', () => {
    const ranked = rankStructured('target', mixedCorpus())
    expect(ranked.map((r) => r.bottleId)).toContain('twin')
    expect(ranked.map((r) => r.bottleId)).not.toContain('brew')
  })

  it('crossFamily surfaces only the other family', () => {
    const cross = rankCross('target', mixedCorpus())
    expect(cross.map((r) => r.bottleId)).toEqual(['brew'])
  })

  it('crossFamily works in the coffee -> alcohol direction too', () => {
    const cross = rankCross('brew', mixedCorpus())
    expect(cross.map((r) => r.bottleId).sort()).toEqual(['target', 'twin'])
  })

  it('crossFamily is empty when the corpus is single-family', () => {
    const corpus: CorpusBottle[] = [
      { item: bottle('t', 'Islay', 'scotch', 46), notes: [] },
      { item: bottle('u', 'Islay', 'scotch', 46), notes: [] },
    ]
    expect(rankCross('t', corpus)).toEqual([])
  })

  it('main text ranking never crosses families, even when the other family embeds closest', () => {
    const corpus: CorpusBottle[] = [
      { item: bottle('target', 'Islay', 'scotch', 46), notes: [note('target', 8, smokyTags, [1, 0, 0])] },
      // The coffee's embedding is nearly identical to the target's...
      { item: bottle('brew', 'Sumatra', 'coffee', 0), notes: [note('brew', 8, smokyTags, [0.99, 0.01, 0])] },
      // ...while the in-family candidate is farther away.
      { item: bottle('twin', 'Speyside', 'scotch', 40), notes: [note('twin', 7, smokyTags, [0.6, 0.4, 0])] },
    ]
    const ranked = rankText('target', corpus)
    expect(ranked).not.toBeNull()
    expect(ranked!.map((r) => r.bottleId)).toEqual(['twin'])
  })

  it('crossFamily prefers the text layer when embeddings exist on both sides', () => {
    const corpus: CorpusBottle[] = [
      { item: bottle('target', 'Islay', 'scotch', 46), notes: [note('target', 8, smokyTags, [1, 0, 0])] },
      { item: bottle('close-brew', 'Sumatra', 'coffee', 0), notes: [note('close-brew', 8, smokyTags, [0.9, 0.1, 0])] },
      { item: bottle('far-brew', 'Yirgacheffe', 'coffee', 0), notes: [note('far-brew', 8, smokyTags, [0, 0, 1])] },
    ]
    const cross = rankCross('target', corpus)
    expect(cross.map((r) => r.bottleId)).toEqual(['close-brew', 'far-brew'])
    expect(cross[0].reason).toMatch(/notes/i)
  })

  it('crossFamily caps at 3', () => {
    const corpus: CorpusBottle[] = [
      { item: bottle('target', 'Islay', 'scotch', 46), notes: [] },
    ]
    for (let i = 0; i < 5; i++) {
      corpus.push({ item: bottle(`c${i}`, 'Huila', 'coffee', 0), notes: [] })
    }
    expect(rankCross('target', corpus).length).toBe(3)
  })

  it('recommend() carries crossFamily even when the main list is empty', async () => {
    const corpus: CorpusBottle[] = [
      { item: bottle('t', 'Islay', 'scotch', 46), notes: [] },
      { item: bottle('brew', 'Huila', 'coffee', 0), notes: [] },
    ]
    const res = await recommend('t', corpus)
    expect(res.recommendations).toEqual([])
    expect(res.crossFamily.map((r) => r.bottleId)).toEqual(['brew'])
    expect(res.degraded).toBe(false)
  })
})
