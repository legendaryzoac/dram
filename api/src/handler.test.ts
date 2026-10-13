import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { APIGatewayProxyEventV2WithJWTAuthorizer } from 'aws-lambda'
import type { BottleItem, NoteItem } from './types'

// In-memory single-table stand-in for the DynamoDB DocumentClient. The store
// module is mocked to read/write this, so the handler's routing + shaping is
// exercised with zero network.
const bottles = new Map<string, BottleItem>()
const notes = new Map<string, NoteItem[]>()

vi.mock('./store', async () => {
  const actual = await vi.importActual<typeof import('./store')>('./store')
  return {
    ...actual,
    listBottleItems: vi.fn(async () => [...bottles.values()]),
    listNoteItems: vi.fn(async () => [...notes.values()].flat()),
    loadNotes: vi.fn(async (id: string) => notes.get(id) ?? []),
    loadBottleWithNotes: vi.fn(async (id: string) => {
      const b = bottles.get(id)
      if (!b) return null
      return { bottle: b, notes: notes.get(id) ?? [] }
    }),
    getBottleItem: vi.fn(async (id: string) => bottles.get(id) ?? null),
    putBottle: vi.fn(async (item: BottleItem) => {
      bottles.set(item.id, item)
    }),
    putNote: vi.fn(async (item: NoteItem) => {
      // Upsert by id, like DynamoDB Put on the same pk/sk (note edits
      // rewrite the item rather than adding a sibling).
      const arr = notes.get(item.bottleId) ?? []
      const idx = arr.findIndex((n) => n.id === item.id)
      if (idx === -1) arr.push(item)
      else arr[idx] = item
      notes.set(item.bottleId, arr)
    }),
    deleteBottleAndNotes: vi.fn(async (id: string) => {
      const existed = bottles.delete(id)
      notes.delete(id)
      return existed
    }),
  }
})

// Bedrock always throws here -> exercises the fail-soft paths (note saved
// without embedding; recommender degrades below narration).
vi.mock('./bedrock', () => ({
  embedText: vi.fn(async () => {
    throw new Error('AccessDeniedException')
  }),
  narrate: vi.fn(async () => {
    throw new Error('AccessDeniedException')
  }),
  narratePairing: vi.fn(async () => {
    throw new Error('AccessDeniedException')
  }),
}))

import { narratePairing } from './bedrock'
import { handler } from './handler'

function makeEvent(
  routeKey: string,
  opts: {
    pathParameters?: Record<string, string>
    body?: unknown
    authed?: boolean
    sub?: string
  } = {},
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
      authorizer: opts.authed
        ? { jwt: { claims: { sub: opts.sub ?? 'user-123' }, scopes: [] } }
        : undefined,
    } as never,
    pathParameters: opts.pathParameters,
    isBase64Encoded: false,
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
  } as APIGatewayProxyEventV2WithJWTAuthorizer
}

function parse(res: Awaited<ReturnType<typeof handler>>): {
  status: number
  body: any
} {
  const r = res as { statusCode: number; body?: string }
  return { status: r.statusCode, body: r.body ? JSON.parse(r.body) : undefined }
}

beforeEach(() => {
  bottles.clear()
  notes.clear()
})

describe('handler routing', () => {
  it('GET /health -> {ok:true}', async () => {
    const { status, body } = parse(await handler(makeEvent('GET /health')))
    expect(status).toBe(200)
    expect(body).toEqual({ ok: true })
  })

  it('unknown route -> 404', async () => {
    const { status } = parse(await handler(makeEvent('GET /nope')))
    expect(status).toBe(404)
  })

  it('POST /bottles without auth -> 401', async () => {
    const res = parse(
      await handler(
        makeEvent('POST /bottles', {
          body: { name: 'x', producer: 'p', region: 'r', type: 't', abv: 40 },
        }),
      ),
    )
    expect(res.status).toBe(401)
  })

  it('POST /bottles with auth -> 200 and returns a Bottle with computed fields', async () => {
    const res = parse(
      await handler(
        makeEvent('POST /bottles', {
          authed: true,
          body: { name: 'Ardbeg 10', producer: 'Ardbeg', region: 'Islay', type: 'scotch', abv: 46 },
        }),
      ),
    )
    expect(res.status).toBe(200)
    expect(res.body).toMatchObject({
      name: 'Ardbeg 10',
      region: 'Islay',
      type: 'scotch',
      abv: 46,
      price: null,
      avgRating: null,
      flavorProfile: null,
      noteCount: 0,
    })
    expect(typeof res.body.id).toBe('string')
  })

  it('POST /bottles with invalid body -> 400', async () => {
    const res = parse(
      await handler(makeEvent('POST /bottles', { authed: true, body: { name: 'x' } })),
    )
    expect(res.status).toBe(400)
  })

  it('GET /bottles/{id} for a missing bottle -> 404', async () => {
    const res = parse(
      await handler(makeEvent('GET /bottles/{id}', { pathParameters: { id: 'ghost' } })),
    )
    expect(res.status).toBe(404)
  })

  it('note write saves without embedding when Bedrock denies, then aggregates onto the bottle', async () => {
    // seed a bottle
    const created = parse(
      await handler(
        makeEvent('POST /bottles', {
          authed: true,
          body: { name: 'Lagavulin 16', producer: 'Lagavulin', region: 'Islay', type: 'scotch', abv: 43 },
        }),
      ),
    )
    const id = created.body.id

    const noteRes = parse(
      await handler(
        makeEvent('POST /bottles/{id}/notes', {
          authed: true,
          pathParameters: { id },
          body: {
            nose: 'peat smoke',
            palate: 'sweet sherry and brine',
            finish: 'long, smoky',
            rating: 9,
            flavorTags: {
              sweet: 3, smoky: 5, fruity: 2, oaky: 3, spicy: 2,
              floral: 0, acidity: 1, body: 4,
            },
          },
        }),
      ),
    )
    expect(noteRes.status).toBe(200)
    // embedding is never returned on the wire
    expect(noteRes.body).not.toHaveProperty('embedding')
    expect(noteRes.body.rating).toBe(9)

    // GET now shows the aggregated rating + flavor profile + noteCount
    const got = parse(
      await handler(makeEvent('GET /bottles/{id}', { pathParameters: { id } })),
    )
    expect(got.body.bottle.noteCount).toBe(1)
    expect(got.body.bottle.avgRating).toBe(9)
    expect(got.body.bottle.flavorProfile).toEqual({
      sweet: 3, smoky: 5, fruity: 2, oaky: 3, spicy: 2,
      floral: 0, acidity: 1, body: 4,
    })
    expect(got.body.notes).toHaveLength(1)
  })

  it('accepts a legacy five-axis note and averages new axes only over notes that measured them', async () => {
    const created = parse(
      await handler(
        makeEvent('POST /bottles', {
          authed: true,
          body: { name: 'Redbreast 12', producer: 'Midleton', region: 'Ireland', type: 'irish', abv: 40 },
        }),
      ),
    )
    const id = created.body.id

    // A pre-expansion client sends only the core five axes — still accepted.
    const legacy = parse(
      await handler(
        makeEvent('POST /bottles/{id}/notes', {
          authed: true,
          pathParameters: { id },
          body: {
            nose: 'sherry', palate: 'creamy', finish: 'long', rating: 8,
            flavorTags: { sweet: 4, smoky: 0, fruity: 4, oaky: 3, spicy: 3 },
          },
        }),
      ),
    )
    expect(legacy.status).toBe(200)
    // The wire note is always a complete FlavorTags (missing axes read 0).
    expect(legacy.body.flavorTags.acidity).toBe(0)

    // A current client sends all eight.
    await handler(
      makeEvent('POST /bottles/{id}/notes', {
        authed: true,
        pathParameters: { id },
        body: {
          nose: 'marzipan', palate: 'pot still spice', finish: 'oily', rating: 9,
          flavorTags: {
            sweet: 4, smoky: 0, fruity: 4, oaky: 3, spicy: 3,
            floral: 1, acidity: 2, body: 4,
          },
        },
      }),
    )

    const got = parse(
      await handler(makeEvent('GET /bottles/{id}', { pathParameters: { id } })),
    )
    // Core axes average over both notes; the newer axes average only over the
    // note that measured them — not dragged down by the legacy note.
    expect(got.body.bottle.flavorProfile).toEqual({
      sweet: 4, smoky: 0, fruity: 4, oaky: 3, spicy: 3,
      floral: 1, acidity: 2, body: 4,
    })
  })

  it('edits a note (author only), stores brew, and stamps updatedAt', async () => {
    const created = parse(
      await handler(
        makeEvent('POST /bottles', {
          authed: true,
          body: {
            name: 'Ethiopia Yirgacheffe', producer: 'Counter Culture',
            region: 'Yirgacheffe, Ethiopia', type: 'coffee', abv: 0,
          },
        }),
      ),
    )
    const bottleId = created.body.id

    const noteRes = parse(
      await handler(
        makeEvent('POST /bottles/{id}/notes', {
          authed: true,
          pathParameters: { id: bottleId },
          body: {
            nose: 'jasmine', palate: 'black tea', finish: 'clean', rating: 8,
            flavorTags: {
              sweet: 3, smoky: 0, fruity: 4, oaky: 0, spicy: 0,
              floral: 5, acidity: 5, body: 1,
            },
            brew: {
              grinder: 'Fellow Ode Gen 2', method: 'V60 pour over',
              grindSize: '4.33', ratio: '1:15', time: '3:02',
            },
          },
        }),
      ),
    )
    expect(noteRes.status).toBe(200)
    expect(noteRes.body.brew).toEqual({
      grinder: 'Fellow Ode Gen 2', method: 'V60 pour over',
      grindSize: '4.33', ratio: '1:15', time: '3:02',
    })
    expect(noteRes.body.updatedAt).toBeUndefined()
    const noteId = noteRes.body.id

    // A different user may not edit it.
    const forbidden = parse(
      await handler(
        makeEvent('PUT /bottles/{id}/notes/{noteId}', {
          authed: true,
          sub: 'someone-else',
          pathParameters: { id: bottleId, noteId },
          body: {
            nose: 'x', palate: 'x', finish: 'x', rating: 5,
            flavorTags: { sweet: 1, smoky: 1, fruity: 1, oaky: 1, spicy: 1 },
          },
        }),
      ),
    )
    expect(forbidden.status).toBe(403)

    // The author edits: content replaced, brew replaced, updatedAt stamped.
    const edited = parse(
      await handler(
        makeEvent('PUT /bottles/{id}/notes/{noteId}', {
          authed: true,
          pathParameters: { id: bottleId, noteId },
          body: {
            nose: 'jasmine, riper', palate: 'lemon curd', finish: 'long', rating: 9,
            flavorTags: {
              sweet: 3, smoky: 0, fruity: 5, oaky: 0, spicy: 0,
              floral: 5, acidity: 5, body: 1,
            },
            brew: { grinder: 'Fellow Ode Gen 2', method: 'AeroPress' },
          },
        }),
      ),
    )
    expect(edited.status).toBe(200)
    expect(edited.body.rating).toBe(9)
    expect(edited.body.palate).toBe('lemon curd')
    expect(edited.body.brew).toEqual({
      grinder: 'Fellow Ode Gen 2', method: 'AeroPress',
    })
    expect(typeof edited.body.updatedAt).toBe('string')
    expect(edited.body.id).toBe(noteId)

    // The bottle aggregate reflects the edit.
    const got = parse(
      await handler(makeEvent('GET /bottles/{id}', { pathParameters: { id: bottleId } })),
    )
    expect(got.body.bottle.avgRating).toBe(9)
    expect(got.body.notes).toHaveLength(1)
  })

  it('editing a missing note 404s', async () => {
    const created = parse(
      await handler(
        makeEvent('POST /bottles', {
          authed: true,
          body: { name: 'x', producer: 'p', region: 'r', type: 't', abv: 40 },
        }),
      ),
    )
    const res = parse(
      await handler(
        makeEvent('PUT /bottles/{id}/notes/{noteId}', {
          authed: true,
          pathParameters: { id: created.body.id, noteId: 'ghost' },
          body: {
            nose: 'n', palate: 'p', finish: 'f', rating: 7,
            flavorTags: { sweet: 1, smoky: 1, fruity: 1, oaky: 1, spicy: 1 },
          },
        }),
      ),
    )
    expect(res.status).toBe(404)
  })

  it('canonicalizes roast on create and update', async () => {
    const created = parse(
      await handler(
        makeEvent('POST /bottles', {
          authed: true,
          body: {
            name: 'Mt Ijen', producer: 'Mango Tree', region: 'Indonesia',
            type: 'coffee', abv: 0, roast: 'Light',
          },
        }),
      ),
    )
    expect(created.body.roast).toBe('light')
    const updated = parse(
      await handler(
        makeEvent('PUT /bottles/{id}', {
          authed: true,
          pathParameters: { id: created.body.id },
          body: { roast: 'Medium Dark' },
        }),
      ),
    )
    expect(updated.body.roast).toBe('medium-dark')
  })

  it('rejects a note missing a core axis', async () => {
    const created = parse(
      await handler(
        makeEvent('POST /bottles', {
          authed: true,
          body: { name: 'x', producer: 'p', region: 'r', type: 't', abv: 40 },
        }),
      ),
    )
    const res = parse(
      await handler(
        makeEvent('POST /bottles/{id}/notes', {
          authed: true,
          pathParameters: { id: created.body.id },
          body: {
            nose: 'n', palate: 'p', finish: 'f', rating: 7,
            flavorTags: { sweet: 3, smoky: 5, fruity: 2, oaky: 3 }, // no spicy
          },
        }),
      ),
    )
    expect(res.status).toBe(400)
  })

  it('stores and returns per-type fields (style / roast / process)', async () => {
    const coffee = parse(
      await handler(
        makeEvent('POST /bottles', {
          authed: true,
          body: {
            name: 'Ethiopia Yirgacheffe', producer: 'Counter Culture',
            region: 'Yirgacheffe, Ethiopia', type: 'coffee', abv: 0,
            roast: 'light', process: 'washed',
          },
        }),
      ),
    )
    expect(coffee.status).toBe(200)
    expect(coffee.body).toMatchObject({ roast: 'light', process: 'washed' })

    const updated = parse(
      await handler(
        makeEvent('PUT /bottles/{id}', {
          authed: true,
          pathParameters: { id: coffee.body.id },
          body: { roast: 'medium', process: null },
        }),
      ),
    )
    expect(updated.status).toBe(200)
    expect(updated.body.roast).toBe('medium')
    expect(updated.body.process).toBeUndefined()

    // Each per-type field clears independently via null (grape/style too).
    const tequila = parse(
      await handler(
        makeEvent('POST /bottles', {
          authed: true,
          body: {
            name: 'Fortaleza Reposado', producer: 'Los Abuelos',
            region: 'Jalisco', type: 'tequila', abv: 40,
            style: 'reposado', grape: 'stray value',
          },
        }),
      ),
    )
    expect(tequila.body).toMatchObject({ style: 'reposado', grape: 'stray value' })
    const cleared = parse(
      await handler(
        makeEvent('PUT /bottles/{id}', {
          authed: true,
          pathParameters: { id: tequila.body.id },
          body: { style: null, grape: null },
        }),
      ),
    )
    expect(cleared.status).toBe(200)
    expect(cleared.body.style).toBeUndefined()
    expect(cleared.body.grape).toBeUndefined()
  })

  it('stores a bottle status, defaults it to the cabinet, and rejects junk', async () => {
    const plain = parse(
      await handler(
        makeEvent('POST /bottles', {
          authed: true,
          body: { name: 'Shelf', producer: 'p', region: 'r', type: 'bourbon', abv: 45 },
        }),
      ),
    )
    expect(plain.body.status).toBe('cabinet')

    const tasted = parse(
      await handler(
        makeEvent('POST /bottles', {
          authed: true,
          body: { name: 'Bar pour', producer: 'p', region: 'r', type: 'scotch', abv: 46, status: 'tasted' },
        }),
      ),
    )
    expect(tasted.body.status).toBe('tasted')

    const bad = parse(
      await handler(
        makeEvent('POST /bottles', {
          authed: true,
          body: { name: 'x', producer: 'p', region: 'r', type: 'rye', abv: 50, status: 'lost' },
        }),
      ),
    )
    expect(bad.status).toBe(400)

    const finished = parse(
      await handler(
        makeEvent('PUT /bottles/{id}', {
          authed: true,
          pathParameters: { id: plain.body.id },
          body: { status: 'finished' },
        }),
      ),
    )
    expect(finished.body.status).toBe('finished')
    const badUpdate = parse(
      await handler(
        makeEvent('PUT /bottles/{id}', {
          authed: true,
          pathParameters: { id: plain.body.id },
          body: { status: null },
        }),
      ),
    )
    expect(badUpdate.status).toBe(400)

    // A pre-status row reads as cabinet on every GET.
    const list = parse(await handler(makeEvent('GET /bottles')))
    for (const b of list.body) expect(['cabinet', 'finished', 'tasted']).toContain(b.status)
  })

  it('pairing context pours only from the cabinet; recommendations still see everything', async () => {
    const ids: Record<string, string> = {}
    for (const body of [
      { name: 'Lagavulin 16', producer: 'p', region: 'Islay', type: 'scotch', abv: 43 },
      { name: 'Bar Ardbeg', producer: 'p', region: 'Islay', type: 'scotch', abv: 46, status: 'tasted' },
      { name: 'Empty Laphroaig', producer: 'p', region: 'Islay', type: 'scotch', abv: 40, status: 'finished' },
    ]) {
      const made = parse(await handler(makeEvent('POST /bottles', { authed: true, body })))
      ids[body.name] = made.body.id
    }
    vi.mocked(narratePairing).mockResolvedValueOnce('Pour the Lagavulin 16.')
    await handler(
      makeEvent('POST /pairings', {
        authed: true,
        body: { kind: 'food', text: 'oysters', candidateIds: [ids['Bar Ardbeg'], ids['Lagavulin 16']] },
      }),
    )
    const input = vi.mocked(narratePairing).mock.calls.at(-1)![0]
    expect(input.cabinet).toHaveLength(1)
    expect(input.cabinet[0]).toMatch(/^Lagavulin 16/)
    expect(input.shortlist).toEqual(['Lagavulin 16'])

    const recs = parse(
      await handler(
        makeEvent('GET /bottles/{id}/recommendations', {
          pathParameters: { id: ids['Lagavulin 16'] },
        }),
      ),
    )
    const names = recs.body.recommendations.map((r: { name: string }) => r.name)
    expect(names).toContain('Bar Ardbeg')
    expect(names).toContain('Empty Laphroaig')
  })

  it('GET /notes returns every note across bottles, newest first, with its bottleId', async () => {
    const ids: string[] = []
    for (const name of ['One', 'Two']) {
      const made = parse(
        await handler(
          makeEvent('POST /bottles', {
            authed: true,
            body: { name, producer: 'p', region: 'r', type: 'rye', abv: 45 },
          }),
        ),
      )
      ids.push(made.body.id)
    }
    expect(parse(await handler(makeEvent('GET /notes'))).body).toEqual([])
    const note = (rating: number) => ({
      nose: 'n',
      palate: 'p',
      finish: 'f',
      rating,
      flavorTags: { sweet: 1, fruity: 1, floral: 1, acidity: 1, body: 1, oaky: 1, smoky: 1, spicy: 1 },
    })
    for (const [i, rating] of [7, 8, 9].entries()) {
      await handler(
        makeEvent('POST /bottles/{id}/notes', {
          authed: true,
          pathParameters: { id: ids[i % 2] },
          body: note(rating),
        }),
      )
    }
    const all = parse(await handler(makeEvent('GET /notes')))
    expect(all.status).toBe(200)
    expect(all.body).toHaveLength(3)
    expect(all.body.map((n: { bottleId: string }) => n.bottleId).sort()).toEqual(
      [ids[0], ids[0], ids[1]].sort(),
    )
    const stamps = all.body.map((n: { createdAt: string }) => n.createdAt)
    expect([...stamps].sort().reverse()).toEqual(stamps)
    // The list still carries the per-bottle aggregates from the same rows.
    const list = parse(await handler(makeEvent('GET /bottles')))
    const one = list.body.find((b: { id: string }) => b.id === ids[0])
    expect(one.noteCount).toBe(2)
    expect(one.avgRating).toBe(8)
  })

  it('DELETE /bottles/{id} with auth -> 204', async () => {
    const created = parse(
      await handler(
        makeEvent('POST /bottles', {
          authed: true,
          body: { name: 'x', producer: 'p', region: 'r', type: 't', abv: 40 },
        }),
      ),
    )
    const del = await handler(
      makeEvent('DELETE /bottles/{id}', { authed: true, pathParameters: { id: created.body.id } }),
    )
    expect((del as { statusCode: number }).statusCode).toBe(204)
    // gone now
    const got = parse(
      await handler(makeEvent('GET /bottles/{id}', { pathParameters: { id: created.body.id } })),
    )
    expect(got.status).toBe(404)
  })

  it('GET /bottles/{id}/recommendations degrades to structured when Bedrock is down', async () => {
    // two similar bottles
    for (const name of ['A', 'B']) {
      await handler(
        makeEvent('POST /bottles', {
          authed: true,
          body: { name, producer: 'p', region: 'Islay', type: 'scotch', abv: 46 },
        }),
      )
    }
    const list = parse(await handler(makeEvent('GET /bottles')))
    const targetId = list.body[0].id
    const res = parse(
      await handler(
        makeEvent('GET /bottles/{id}/recommendations', { pathParameters: { id: targetId } }),
      ),
    )
    expect(res.status).toBe(200)
    // No embeddings + narrate throws -> structured floor, degraded reflects the
    // narration attempt failing.
    expect(res.body.basis).toBe('structured')
    expect(res.body.recommendations.length).toBeGreaterThan(0)
  })

  it('POST /pairings without auth -> 401', async () => {
    const res = parse(
      await handler(makeEvent('POST /pairings', { body: { kind: 'food', text: 'ribeye' } })),
    )
    expect(res.status).toBe(401)
  })

  it('POST /pairings with a bad body -> 400', async () => {
    for (const body of [
      { kind: 'food' },
      { kind: 'cigar', strength: 'nuclear' },
      { kind: 'beer', text: 'x' },
    ]) {
      const res = parse(await handler(makeEvent('POST /pairings', { authed: true, body })))
      expect(res.status).toBe(400)
    }
  })

  it('POST /pairings degrades to no narration when Bedrock is down', async () => {
    const res = parse(
      await handler(
        makeEvent('POST /pairings', { authed: true, body: { kind: 'food', text: 'ribeye' } }),
      ),
    )
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ narration: null, degraded: true })
  })

  it('POST /pairings narrates over the cabinet, resolving the shortlist by id', async () => {
    const ids: Record<string, string> = {}
    for (const body of [
      { name: 'Lagavulin 16', producer: 'p', region: 'Islay', type: 'scotch', abv: 43 },
      { name: 'Caymus Cabernet', producer: 'p', region: 'Napa', type: 'red wine', abv: 15 },
      { name: 'Sumatra', producer: 'p', region: 'Indonesia', type: 'coffee', abv: 0 },
    ]) {
      const made = parse(await handler(makeEvent('POST /bottles', { authed: true, body })))
      ids[body.name] = made.body.id
    }
    await handler(
      makeEvent('POST /bottles/{id}/notes', {
        authed: true,
        pathParameters: { id: ids['Lagavulin 16'] },
        body: {
          nose: 'peat', palate: 'smoke and brine', finish: 'long', rating: 9,
          flavorTags: { sweet: 1, smoky: 5, fruity: 2, oaky: 3, spicy: 2 },
        },
      }),
    )
    // The drinker's single highest-rated note is a coffee — it must not
    // become a pairing "favourite", since coffee can't be poured here.
    await handler(
      makeEvent('POST /bottles/{id}/notes', {
        authed: true,
        pathParameters: { id: ids['Sumatra'] },
        body: {
          nose: 'cocoa', palate: 'molasses and smoke', finish: 'long', rating: 10,
          flavorTags: { sweet: 2, smoky: 3, fruity: 1, oaky: 3, spicy: 2 },
        },
      }),
    )

    vi.mocked(narratePairing).mockResolvedValueOnce('Pour the Lagavulin 16.')
    const res = parse(
      await handler(
        makeEvent('POST /pairings', {
          authed: true,
          body: {
            kind: 'cigar', brand: 'Padrón', strength: 'full', wrapper: 'maduro',
            candidateIds: [ids['Lagavulin 16'], 'ghost-id'],
          },
        }),
      ),
    )
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ narration: 'Pour the Lagavulin 16.', degraded: false })

    const input = vi.mocked(narratePairing).mock.calls.at(-1)![0]
    expect(input.kindWord).toBe('cigar')
    expect(input.occasion).toBe('a cigar — Padrón · strength: full · wrapper: maduro')
    // Rated bottle first, with its note; coffee never appears; unknown ids dropped.
    expect(input.cabinet[0]).toMatch(/^Lagavulin 16 — scotch, Islay, 43% · rated 9\/10 · "smoke and brine"/)
    expect(input.cabinet).toHaveLength(2)
    expect(input.cabinet.join('\n')).not.toMatch(/Sumatra/)
    expect(input.shortlist).toEqual(['Lagavulin 16'])
    expect(input.highlights).toHaveLength(1)
    expect(input.highlights[0]).toMatch(/Lagavulin 16 \(rated 9\/10\)/)
  })

  it('recommendations stay in-family and surface the other family via crossFamily', async () => {
    for (const body of [
      { name: 'Lagavulin 16', producer: 'p', region: 'Islay', type: 'scotch', abv: 43 },
      { name: 'Ardbeg 10', producer: 'p', region: 'Islay', type: 'scotch', abv: 46 },
      { name: 'Sumatra', producer: 'p', region: 'Indonesia', type: 'coffee', abv: 0 },
    ]) {
      await handler(makeEvent('POST /bottles', { authed: true, body }))
    }
    const list = parse(await handler(makeEvent('GET /bottles')))
    const scotch = list.body.find((b: { type: string }) => b.type === 'scotch')
    const res = parse(
      await handler(
        makeEvent('GET /bottles/{id}/recommendations', {
          pathParameters: { id: scotch.id },
        }),
      ),
    )
    expect(res.status).toBe(200)
    const names = res.body.recommendations.map((r: { name: string }) => r.name)
    expect(names).not.toContain('Sumatra')
    expect(res.body.crossFamily.map((r: { name: string }) => r.name)).toEqual([
      'Sumatra',
    ])
  })
})
