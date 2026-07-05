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
      const arr = notes.get(item.bottleId) ?? []
      arr.push(item)
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
}))

import { handler } from './handler'

function makeEvent(
  routeKey: string,
  opts: {
    pathParameters?: Record<string, string>
    body?: unknown
    authed?: boolean
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
        ? { jwt: { claims: { sub: 'user-123' }, scopes: [] } }
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
            flavorTags: { sweet: 3, smoky: 5, fruity: 2, oaky: 3, spicy: 2 },
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
    })
    expect(got.body.notes).toHaveLength(1)
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
})
