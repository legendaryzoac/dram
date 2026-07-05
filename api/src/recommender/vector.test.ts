import { describe, expect, it } from 'vitest'
import {
  buildVocab,
  cosine,
  meanVector,
  rankBySimilarity,
  toScore,
  vectorize,
  type StructuredBottle,
} from './vector'

describe('cosine', () => {
  it('is 1 for identical direction', () => {
    expect(cosine([1, 2, 3], [1, 2, 3])).toBeCloseTo(1)
    expect(cosine([1, 0], [2, 0])).toBeCloseTo(1) // scale-invariant
  })

  it('is 0 for orthogonal vectors', () => {
    expect(cosine([1, 0], [0, 1])).toBeCloseTo(0)
  })

  it('is -1 for opposite direction', () => {
    expect(cosine([1, 2], [-1, -2])).toBeCloseTo(-1)
  })

  it('returns 0 (not NaN) when either vector is zero-magnitude', () => {
    expect(cosine([0, 0, 0], [1, 2, 3])).toBe(0)
    expect(cosine([1, 2, 3], [0, 0, 0])).toBe(0)
    expect(cosine([0, 0], [0, 0])).toBe(0)
  })

  it('throws on length mismatch', () => {
    expect(() => cosine([1, 2], [1, 2, 3])).toThrow(/length mismatch/)
  })
})

describe('toScore', () => {
  it('maps [-1,1] cosine into [0,1]', () => {
    expect(toScore(1)).toBe(1)
    expect(toScore(0)).toBeCloseTo(0.5)
    expect(toScore(-1)).toBe(0)
  })
  it('clamps out-of-range input', () => {
    expect(toScore(2)).toBe(1)
    expect(toScore(-2)).toBe(0)
  })
})

describe('meanVector', () => {
  it('averages component-wise', () => {
    expect(meanVector([[0, 0], [2, 4]])).toEqual([1, 2])
  })
  it('returns null for an empty set', () => {
    expect(meanVector([])).toBeNull()
  })
  it('throws on ragged input', () => {
    expect(() => meanVector([[1, 2], [1]])).toThrow(/ragged/)
  })
})

describe('vectorize + buildVocab', () => {
  const bottles: StructuredBottle[] = [
    {
      id: 'a',
      region: 'Islay',
      type: 'scotch',
      abv: 46,
      flavorProfile: { sweet: 1, smoky: 5, fruity: 1, oaky: 3, spicy: 2 },
    },
    {
      id: 'b',
      region: 'Speyside',
      type: 'scotch',
      abv: 40,
      flavorProfile: { sweet: 4, smoky: 0, fruity: 4, oaky: 2, spicy: 1 },
    },
    {
      id: 'c',
      region: 'Islay',
      type: 'scotch',
      abv: 48,
      flavorProfile: null,
    },
  ]

  it('one-hots region/type from a sorted, deduped vocab', () => {
    const vocab = buildVocab(bottles)
    expect(vocab.regions).toEqual(['Islay', 'Speyside'])
    expect(vocab.types).toEqual(['scotch'])
  })

  it('produces equal-length vectors across the corpus', () => {
    const vocab = buildVocab(bottles)
    const vs = bottles.map((b) => vectorize(b, vocab))
    const dim = vs[0].length
    // 2 regions + 1 type + 5 flavor + 1 abv = 9
    expect(dim).toBe(9)
    expect(vs.every((v) => v.length === dim)).toBe(true)
  })

  it('uses a neutral flavor block when the profile is absent', () => {
    const vocab = buildVocab(bottles)
    const v = vectorize(bottles[2], vocab) // c has null profile
    // flavor dims are positions [regions(2)+types(1)] .. +5
    const flavor = v.slice(3, 8)
    expect(flavor).toEqual([0.5, 0.5, 0.5, 0.5, 0.5])
  })

  it('scales abv into ~[0,1]', () => {
    const vocab = buildVocab(bottles)
    const v = vectorize(bottles[0], vocab)
    expect(v[v.length - 1]).toBeCloseTo(46 / 65)
  })
})

describe('rankBySimilarity', () => {
  it('orders candidates by descending similarity to the target', () => {
    const target = [1, 0, 0]
    const ranked = rankBySimilarity(target, [
      { id: 'far', vector: [0, 1, 0] }, // orthogonal -> 0.5
      { id: 'near', vector: [1, 0.1, 0] }, // close -> high
      { id: 'opp', vector: [-1, 0, 0] }, // opposite -> 0
    ])
    expect(ranked.map((r) => r.id)).toEqual(['near', 'far', 'opp'])
    expect(ranked[0].score).toBeGreaterThan(ranked[1].score)
    expect(ranked[1].score).toBeGreaterThan(ranked[2].score)
  })

  it('breaks ties by id ascending for deterministic output', () => {
    const target = [1, 0]
    const ranked = rankBySimilarity(target, [
      { id: 'z', vector: [1, 0] },
      { id: 'a', vector: [1, 0] },
      { id: 'm', vector: [1, 0] },
    ])
    expect(ranked.map((r) => r.id)).toEqual(['a', 'm', 'z'])
  })

  it('handles an empty candidate set', () => {
    expect(rankBySimilarity([1, 0], [])).toEqual([])
  })
})
