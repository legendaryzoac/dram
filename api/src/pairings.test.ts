import { describe, expect, it } from 'vitest'
import type { BottleItem, NoteItem } from './types'
import type { CorpusBottle } from './recommender'
import { cabinetLines, cabinetOnly, describeOccasion, parsePairingBody } from './pairings'

function bottle(id: string, name: string, type: string, style?: string): BottleItem {
  return {
    pk: `BOTTLE#${id}`,
    sk: 'META',
    type: 'bottle',
    id,
    name,
    producer: 'P',
    region: 'Somewhere',
    type_: type,
    abv: 43,
    price: null,
    style,
    createdAt: '2026-01-01T00:00:00.000Z',
  }
}

let seq = 0
function note(bottleId: string, rating: number, palate: string): NoteItem {
  seq += 1
  return {
    pk: `BOTTLE#${bottleId}`,
    sk: `NOTE#2026-01-01#n${seq}`,
    type: 'note',
    id: `n${seq}`,
    bottleId,
    nose: 'n',
    palate,
    finish: 'f',
    rating,
    flavorTags: { sweet: 1, smoky: 1, fruity: 1, oaky: 1, spicy: 1 },
    createdAt: '2026-01-01T00:00:00.000Z',
  }
}

describe('parsePairingBody', () => {
  it('accepts a food request and trims it', () => {
    expect(parsePairingBody({ kind: 'food', text: '  ribeye ', reading: 'Steak & red meat' })).toEqual({
      kind: 'food', text: 'ribeye', reading: 'Steak & red meat', candidateIds: [],
    })
  })

  it('accepts a cigar request with optional fields blank', () => {
    expect(
      parsePairingBody({ kind: 'cigar', strength: 'full', brand: 'Padrón', line: '', wrapper: null }),
    ).toEqual({ kind: 'cigar', brand: 'Padrón', line: undefined, strength: 'full', wrapper: undefined, candidateIds: [] })
  })

  it('rejects what it should', () => {
    expect(parsePairingBody(null)).toBeNull()
    expect(parsePairingBody({ kind: 'wine' })).toBeNull()
    expect(parsePairingBody({ kind: 'food', text: '' })).toBeNull()
    expect(parsePairingBody({ kind: 'food', text: 'x'.repeat(201) })).toBeNull()
    expect(parsePairingBody({ kind: 'food', text: 'ok', reading: 42 })).toBeNull()
    expect(parsePairingBody({ kind: 'cigar', strength: 'nuclear' })).toBeNull()
    expect(parsePairingBody({ kind: 'cigar', strength: 'mild', brand: 'x'.repeat(81) })).toBeNull()
    expect(parsePairingBody({ kind: 'food', text: 'ok', candidateIds: 'b1' })).toBeNull()
    expect(parsePairingBody({ kind: 'food', text: 'ok', candidateIds: [1] })).toBeNull()
    expect(parsePairingBody({ kind: 'food', text: 'ok', candidateIds: ['a', 'b', 'c', 'd', 'e', 'f'] })).toBeNull()
  })

  it('keeps up to five candidate ids', () => {
    const p = parsePairingBody({ kind: 'food', text: 'ok', candidateIds: ['a', 'b'] })
    expect(p?.candidateIds).toEqual(['a', 'b'])
  })
})

describe('describeOccasion', () => {
  it('describes food with the client reading when given', () => {
    expect(describeOccasion({ kind: 'food', text: 'ribeye', reading: 'Steak & red meat', candidateIds: [] }))
      .toBe('food — "ribeye" (the app\'s flavor-math read it as: Steak & red meat)')
    expect(describeOccasion({ kind: 'food', text: 'ribeye', candidateIds: [] })).toBe('food — "ribeye"')
  })

  it('describes a cigar by name, strength, and wrapper', () => {
    expect(describeOccasion({ kind: 'cigar', brand: 'Padrón', line: '1964', strength: 'full', wrapper: 'maduro', candidateIds: [] }))
      .toBe('a cigar — Padrón 1964 · strength: full · wrapper: maduro')
    expect(describeOccasion({ kind: 'cigar', strength: 'medium', candidateIds: [] }))
      .toBe('a cigar — an unnamed cigar · strength: medium')
  })
})

describe('cabinetLines', () => {
  const corpus: CorpusBottle[] = [
    { item: bottle('b1', 'Buffalo Trace', 'bourbon'), notes: [note('b1', 8, 'Brown sugar, toffee, oak.')] },
    { item: bottle('b2', 'Lagavulin 16', 'scotch'), notes: [note('b2', 9, 'Huge peat smoke and brine.'), note('b2', 7, 'Ashy.')] },
    { item: bottle('b3', 'Mystery Malbec', 'red wine'), notes: [] },
    { item: bottle('c1', 'Sumatra', 'coffee'), notes: [note('c1', 10, 'Chocolate.')] },
    { item: bottle('b4', 'Fortaleza Blanco', 'tequila', 'blanco'), notes: [note('b4', 9, 'x'.repeat(200))] },
  ]

  it('cabinetOnly drops coffee', () => {
    expect(cabinetOnly(corpus).map((b) => b.item.name)).not.toContain('Sumatra')
    expect(cabinetOnly(corpus)).toHaveLength(4)
  })

  it('lists best-rated first (ties by name), unrated last', () => {
    const lines = cabinetLines(cabinetOnly(corpus))
    expect(lines).toHaveLength(4)
    expect(lines[0]).toMatch(/^Fortaleza Blanco — tequila, blanco, Somewhere, 43% · rated 9\/10/)
    // Buffalo Trace (8) and Lagavulin (avg of 9 and 7 = 8) tie; name breaks it.
    expect(lines[1]).toMatch(/^Buffalo Trace — bourbon, Somewhere, 43% · rated 8\/10 · "Brown sugar, toffee, oak\."/)
    expect(lines[2]).toMatch(/^Lagavulin 16 — scotch, Somewhere, 43% · rated 8\/10 · "Huge peat smoke and brine\."/)
    expect(lines[3]).toBe('Mystery Malbec — red wine, Somewhere, 43% · unrated')
  })

  it('truncates long notes and respects the cap', () => {
    const lines = cabinetLines(cabinetOnly(corpus))
    expect(lines[0].length).toBeLessThan(200)
    expect(lines[0]).toMatch(/…"$/)
    expect(cabinetLines(cabinetOnly(corpus), 2)).toHaveLength(2)
  })

  it('keeps shortlisted bottles inside the cap, in rating order', () => {
    // Cap of 2 would normally cut the unrated Malbec; the shortlist pins it.
    const lines = cabinetLines(cabinetOnly(corpus), 2, new Set(['b3']))
    expect(lines).toHaveLength(2)
    expect(lines[0]).toMatch(/^Fortaleza Blanco/)
    expect(lines[1]).toMatch(/^Mystery Malbec/)
    // Pinned ids never push the list past the cap.
    expect(cabinetLines(cabinetOnly(corpus), 1, new Set(['b1', 'b3']))).toHaveLength(2)
  })
})
