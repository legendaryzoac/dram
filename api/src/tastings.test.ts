import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { APIGatewayProxyEventV2WithJWTAuthorizer } from 'aws-lambda'
import type { BottleItem, NoteItem, TastingItem } from './types'

// In-memory stand-ins for the table, as in handler.test.ts, plus tastings.
const bottles = new Map<string, BottleItem>()
const notes = new Map<string, NoteItem[]>()
const tastings = new Map<string, TastingItem>()

vi.mock('./store', async () => {
  const actual = await vi.importActual<typeof import('./store')>('./store')
  return {
    ...actual,
    getBottleItem: vi.fn(async (id: string) => bottles.get(id) ?? null),
    loadNotes: vi.fn(async (id: string) => notes.get(id) ?? []),
    putNote: vi.fn(async (item: NoteItem) => {
      const arr = notes.get(item.bottleId) ?? []
      arr.push(item)
      notes.set(item.bottleId, arr)
    }),
    putNewTasting: vi.fn(async (item: TastingItem) => {
      if (tastings.has(item.code)) return false
      tastings.set(item.code, { ...item })
      return true
    }),
    getTastingItem: vi.fn(async (code: string) => {
      const t = tastings.get(code)
      return t ? { ...t } : null
    }),
    listTastingItems: vi.fn(async (sub: string) =>
      [...tastings.values()].filter((t) => t.ownerSub === sub),
    ),
    claimTastingNote: vi.fn(async (code: string, now: string, max: number) => {
      const t = tastings.get(code)
      if (!t || t.endedAt || t.expiresAt <= now || t.noteCount >= max) return false
      t.noteCount += 1
      return true
    }),
    endTastingItem: vi.fn(async (code: string, sub: string, now: string) => {
      const t = tastings.get(code)
      if (!t || t.ownerSub !== sub) return null
      t.endedAt ??= now
      return { ...t }
    }),
  }
})

const embedText = vi.fn(async () => [0.1, 0.2, 0.3])
vi.mock('./bedrock', () => ({
  embedText: (...a: unknown[]) => embedText(...(a as [])),
  narrate: vi.fn(),
  narratePairing: vi.fn(),
}))

import { handler } from './handler'
import { normalizeCode, generateCode } from './tastings'

function makeEvent(
  routeKey: string,
  opts: { pathParameters?: Record<string, string>; body?: unknown; sub?: string } = {},
): APIGatewayProxyEventV2WithJWTAuthorizer {
  const [method, rawPath] = routeKey.split(' ')
  return {
    version: '2.0',
    routeKey,
    rawPath,
    rawQueryString: '',
    headers: { origin: 'https://dram.zackwithers.com' },
    requestContext: {
      http: { method, path: rawPath, protocol: 'HTTP/1.1', sourceIp: '', userAgent: '' },
      authorizer: opts.sub ? { jwt: { claims: { sub: opts.sub }, scopes: [] } } : undefined,
    } as never,
    pathParameters: opts.pathParameters,
    isBase64Encoded: false,
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
  } as APIGatewayProxyEventV2WithJWTAuthorizer
}

async function call(routeKey: string, opts: Parameters<typeof makeEvent>[1] = {}) {
  const r = (await handler(makeEvent(routeKey, opts))) as { statusCode: number; body?: string }
  return { status: r.statusCode, body: r.body ? JSON.parse(r.body) : undefined }
}

const NOTE = {
  nose: 'peat', palate: 'brine', finish: 'long', rating: 8,
  flavorTags: { sweet: 1, fruity: 1, floral: 0, acidity: 1, body: 3, oaky: 2, smoky: 5, spicy: 2 },
}

beforeEach(() => {
  bottles.clear()
  notes.clear()
  tastings.clear()
  embedText.mockClear()
  bottles.set('b1', {
    pk: 'BOTTLE#b1', sk: 'META', type: 'bottle', id: 'b1', name: 'Ardbeg 10',
    producer: 'Ardbeg', region: 'Islay', type_: 'scotch', abv: 46, price: null,
    createdAt: '2026-01-01T00:00:00Z',
  })
})

async function openTasting(label?: string) {
  const res = await call('POST /tastings', { sub: 'owner', body: label ? { label } : {} })
  expect(res.status).toBe(200)
  return res.body as { code: string; id: string; expiresAt: string; label: string }
}

describe('codes', () => {
  it('generates 8 unambiguous characters', () => {
    for (let i = 0; i < 50; i++) expect(generateCode()).toMatch(/^[2-9A-HJ-NP-Z]{8}$/)
  })
  it('normalizes dashes, spaces and case; rejects junk', () => {
    expect(normalizeCode('peat-7k2q')).toBe('PEAT7K2Q')
    expect(normalizeCode(' PEAT 7K2Q ')).toBe('PEAT7K2Q')
    expect(normalizeCode('PEAT7K2')).toBeNull()
    expect(normalizeCode('PEAT7K20')).toBeNull() // 0 isn't in the alphabet
  })
})

describe('group tastings', () => {
  it('hosting needs an account', async () => {
    expect((await call('POST /tastings', { body: {} })).status).toBe(401)
    expect((await call('GET /tastings')).status).toBe(401)
  })

  it('opens an 8-hour tasting the host can list', async () => {
    const t = await openTasting('Islay night')
    expect(t.label).toBe('Islay night')
    const hours = (Date.parse(t.expiresAt) - Date.now()) / 3_600_000
    expect(hours).toBeGreaterThan(7.99)
    expect(hours).toBeLessThanOrEqual(8)
    const list = await call('GET /tastings', { sub: 'owner' })
    expect(list.body).toHaveLength(1)
    expect(list.body[0]).toMatchObject({ code: t.code, status: 'live', noteCount: 0 })
    // Another account sees none of it.
    expect((await call('GET /tastings', { sub: 'someone' })).body).toEqual([])
  })

  it('a guest checks the code (dashed, any case) and sees no owner data', async () => {
    const t = await openTasting()
    const dashed = `${t.code.slice(0, 4)}-${t.code.slice(4)}`.toLowerCase()
    const res = await call('GET /tastings/{code}', { pathParameters: { code: dashed } })
    expect(res.status).toBe(200)
    expect(Object.keys(res.body).sort()).toEqual(['expiresAt', 'id', 'label'])
  })

  it('unknown code -> 404', async () => {
    const res = await call('GET /tastings/{code}', { pathParameters: { code: 'ZZZZZZZZ' } })
    expect(res.status).toBe(404)
  })

  it('a guest logs a note with no account; it carries their name and is embedded', async () => {
    const t = await openTasting()
    const res = await call('POST /tastings/{code}/bottles/{id}/notes', {
      pathParameters: { code: t.code, id: 'b1' },
      body: { ...NOTE, taster: '  Sam  ' },
    })
    expect(res.status).toBe(200)
    expect(res.body).toMatchObject({ taster: 'Sam', tastingId: t.id, rating: 8 })
    // The code never lands on a (publicly readable) note.
    expect(JSON.stringify(res.body)).not.toContain(t.code)
    const stored = notes.get('b1')![0]
    expect(stored.authorSub).toBe(`tasting:${t.id}`)
    expect(stored.embedding).toEqual([0.1, 0.2, 0.3])
    expect(tastings.get(t.code)!.noteCount).toBe(1)
  })

  it('requires a name, and a bad body spends no slot', async () => {
    const t = await openTasting()
    const noName = await call('POST /tastings/{code}/bottles/{id}/notes', {
      pathParameters: { code: t.code, id: 'b1' },
      body: NOTE,
    })
    expect(noName.status).toBe(400)
    const badNote = await call('POST /tastings/{code}/bottles/{id}/notes', {
      pathParameters: { code: t.code, id: 'b1' },
      body: { taster: 'Sam', rating: 99 },
    })
    expect(badNote.status).toBe(400)
    expect(tastings.get(t.code)!.noteCount).toBe(0)
  })

  it('a missing bottle -> 404', async () => {
    const t = await openTasting()
    const res = await call('POST /tastings/{code}/bottles/{id}/notes', {
      pathParameters: { code: t.code, id: 'ghost' },
      body: { ...NOTE, taster: 'Sam' },
    })
    expect(res.status).toBe(404)
  })

  it('an expired code -> 410 on both guest routes', async () => {
    const t = await openTasting()
    tastings.get(t.code)!.expiresAt = new Date(Date.now() - 1000).toISOString()
    expect((await call('GET /tastings/{code}', { pathParameters: { code: t.code } })).status).toBe(410)
    const res = await call('POST /tastings/{code}/bottles/{id}/notes', {
      pathParameters: { code: t.code, id: 'b1' },
      body: { ...NOTE, taster: 'Sam' },
    })
    expect(res.status).toBe(410)
    expect(notes.get('b1')).toBeUndefined()
  })

  it('the host ends it early; only the host can', async () => {
    const t = await openTasting()
    const stranger = await call('DELETE /tastings/{code}', { sub: 'someone', pathParameters: { code: t.code } })
    expect(stranger.status).toBe(404)
    const ended = await call('DELETE /tastings/{code}', { sub: 'owner', pathParameters: { code: t.code } })
    expect(ended.status).toBe(200)
    expect(ended.body.status).toBe('ended')
    const res = await call('POST /tastings/{code}/bottles/{id}/notes', {
      pathParameters: { code: t.code, id: 'b1' },
      body: { ...NOTE, taster: 'Sam' },
    })
    expect(res.status).toBe(410)
  })

  it('a code is no use for anything but logging notes', async () => {
    // Every other write still needs a Cognito session.
    expect((await call('POST /bottles', { body: { name: 'x' } })).status).toBe(401)
    expect((await call('POST /pairings', { body: { kind: 'food', text: 'x' } })).status).toBe(401)
  })

  it("nobody can edit a guest's note through PUT", async () => {
    const t = await openTasting()
    const res = await call('POST /tastings/{code}/bottles/{id}/notes', {
      pathParameters: { code: t.code, id: 'b1' },
      body: { ...NOTE, taster: 'Sam' },
    })
    const edit = await call('PUT /bottles/{id}/notes/{noteId}', {
      sub: 'owner',
      pathParameters: { id: 'b1', noteId: res.body.id },
      body: NOTE,
    })
    expect(edit.status).toBe(403)
  })

  it('caps notes per tasting -> 429', async () => {
    const t = await openTasting()
    tastings.get(t.code)!.noteCount = 300
    const res = await call('POST /tastings/{code}/bottles/{id}/notes', {
      pathParameters: { code: t.code, id: 'b1' },
      body: { ...NOTE, taster: 'Sam' },
    })
    expect(res.status).toBe(429)
  })
})
