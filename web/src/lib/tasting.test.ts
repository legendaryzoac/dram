import { describe, expect, it } from 'vitest'
import { makeMockApi } from './mockApi'
import { ApiError } from './api'
import { EMPTY_FLAVOR, formatCode } from './types'
import { shareLink, timeLeft } from './tasting'

const NOTE = { nose: 'peat', palate: 'brine', finish: 'long', rating: 8, flavorTags: EMPTY_FLAVOR }

describe('group tasting helpers', () => {
  it('formats codes as XXXX-XXXX', () => {
    expect(formatCode('peat7k2q')).toBe('PEAT-7K2Q')
    expect(formatCode('PEAT-7K2Q')).toBe('PEAT-7K2Q')
  })
  it('counts down', () => {
    const now = Date.parse('2026-01-01T00:00:00Z')
    expect(timeLeft('2026-01-01T08:00:00Z', now)).toBe('8h 0m')
    expect(timeLeft('2026-01-01T00:12:30Z', now)).toBe('12m')
    expect(timeLeft('2026-01-01T00:00:20Z', now)).toBe('under a minute')
    expect(timeLeft('2025-12-31T23:00:00Z', now)).toBe('ended')
  })
  it('builds a share link onto the hash route', () => {
    expect(shareLink('PEAT7K2Q', { origin: 'https://dram.zackwithers.com', pathname: '/' })).toBe(
      'https://dram.zackwithers.com/#/tasting/PEAT7K2Q',
    )
  })
})

describe('mock API — group tastings', () => {
  it('host opens a tasting; a guest joins with the code and logs a note with no token', async () => {
    const api = makeMockApi()
    const t = await api.createTasting({ label: 'Islay night' }, 'demo-token')
    expect(t.status).toBe('live')
    expect((Date.parse(t.expiresAt) - Date.now()) / 3_600_000).toBeCloseTo(8, 1)

    const invite = await api.getTasting(formatCode(t.code).toLowerCase())
    expect(invite.label).toBe('Islay night')

    const [bottle] = await api.listBottles()
    const note = await api.addTastingNote(t.code, bottle.id, { ...NOTE, taster: 'Sam' })
    expect(note).toMatchObject({ taster: 'Sam', tastingId: t.id })
    const detail = await api.getBottle(bottle.id)
    expect(detail.notes.some((n) => n.id === note.id)).toBe(true)
    expect((await api.listTastings('demo-token'))[0].noteCount).toBe(1)

    // Nobody can edit it afterwards.
    await expect(api.updateNote(bottle.id, note.id, NOTE, 'demo-token')).rejects.toMatchObject({
      status: 403,
    })
  })

  it('an ended tasting turns the code away', async () => {
    const api = makeMockApi()
    const t = await api.createTasting({}, 'demo-token')
    await api.endTasting(t.code, 'demo-token')
    const [bottle] = await api.listBottles()
    const err = await api.addTastingNote(t.code, bottle.id, { ...NOTE, taster: 'Sam' }).catch((e) => e)
    expect(err).toBeInstanceOf(ApiError)
    expect(err.status).toBe(410)
    await expect(api.getTasting('ZZZZ-ZZZZ')).rejects.toMatchObject({ status: 404 })
  })
})
