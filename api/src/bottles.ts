import { randomUUID } from 'node:crypto'
import type {
  APIGatewayProxyEventV2,
  APIGatewayProxyResultV2,
} from 'aws-lambda'
import { json, noContent } from './http'
import {
  deleteBottleAndNotes,
  getBottleItem,
  listBottleItems,
  loadBottleWithNotes,
  loadNotes,
  putBottle,
  toBottle,
  toNote,
} from './store'
import {
  BOTTLE_STATUSES,
  normalizeRoast,
  type BottleItem,
  type BottleStatus,
} from './types'

const str = (v: unknown, max: number): string | undefined =>
  typeof v === 'string' && v.trim().length > 0 && v.length <= max
    ? v.trim()
    : undefined

const num = (v: unknown): number | undefined =>
  typeof v === 'number' && Number.isFinite(v) ? v : undefined

/** A bottle status, or undefined for anything that isn't one. */
const status = (v: unknown): BottleStatus | undefined =>
  typeof v === 'string' && (BOTTLE_STATUSES as readonly string[]).includes(v)
    ? (v as BottleStatus)
    : undefined

function parseBody(event: APIGatewayProxyEventV2): unknown {
  const raw = event.isBase64Encoded
    ? Buffer.from(event.body ?? '', 'base64').toString('utf8')
    : (event.body ?? '')
  if (raw.length > 16_000) return null
  try {
    return JSON.parse(raw)
  } catch {
    return null
  }
}

/** GET /bottles -> Bottle[] (public). Aggregates each bottle's notes. */
export async function handleListBottles(
  origin?: string,
): Promise<APIGatewayProxyResultV2> {
  const items = await listBottleItems()
  // Aggregate note-derived fields per bottle. Sequential is fine at this scale.
  const bottles = []
  for (const item of items) {
    const notes = await loadNotes(item.id)
    bottles.push(toBottle(item, notes))
  }
  // Newest first.
  bottles.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
  return json(200, bottles, origin)
}

/** GET /bottles/{id} -> { bottle, notes } (public, 404 if missing). */
export async function handleGetBottle(
  id: string,
  origin?: string,
): Promise<APIGatewayProxyResultV2> {
  const loaded = await loadBottleWithNotes(id)
  if (!loaded) return json(404, { error: 'bottle not found' }, origin)
  return json(
    200,
    {
      bottle: toBottle(loaded.bottle, loaded.notes),
      notes: loaded.notes
        .map(toNote)
        .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1)),
    },
    origin,
  )
}

/** POST /bottles (auth) -> Bottle. */
export async function handleCreateBottle(
  event: APIGatewayProxyEventV2,
  origin?: string,
): Promise<APIGatewayProxyResultV2> {
  const raw = parseBody(event)
  if (typeof raw !== 'object' || raw === null) {
    return json(400, { error: 'invalid json' }, origin)
  }
  const r = raw as Record<string, unknown>

  const name = str(r.name, 200)
  const producer = str(r.producer, 200)
  const region = str(r.region, 120)
  const type = str(r.type, 60)
  const abv = num(r.abv)
  if (!name || !producer || !region || !type || abv === undefined) {
    return json(400, { error: 'name, producer, region, type, abv required' }, origin)
  }
  if (abv < 0 || abv > 100) {
    return json(400, { error: 'abv must be 0..100' }, origin)
  }
  const price = r.price === null || r.price === undefined ? null : num(r.price)
  if (price !== null && (price === undefined || price < 0)) {
    return json(400, { error: 'price must be a non-negative number or null' }, origin)
  }
  // Where it stands: defaults to the cabinet; anything else must be a known
  // status (a stale client that doesn't send one still gets the default).
  const bottleStatus = r.status === undefined ? 'cabinet' : status(r.status)
  if (!bottleStatus) {
    return json(400, { error: 'status must be cabinet, finished, or tasted' }, origin)
  }
  // Optional per-type fields, additive. Undefined when absent/blank/null so
  // DDB stores nothing. Roast is canonicalized ("Light" -> "light").
  const grape = r.grape === undefined ? undefined : str(r.grape, 120)
  const style = r.style === undefined ? undefined : str(r.style, 120)
  const rawRoast = r.roast === undefined ? undefined : str(r.roast, 120)
  const roast = rawRoast === undefined ? undefined : normalizeRoast(rawRoast)
  const process = r.process === undefined ? undefined : str(r.process, 120)

  const id = randomUUID()
  const item: BottleItem = {
    pk: `BOTTLE#${id}`,
    sk: 'META',
    type: 'bottle',
    id,
    name,
    producer,
    region,
    type_: type,
    abv,
    price,
    status: bottleStatus,
    grape,
    style,
    roast,
    process,
    createdAt: new Date().toISOString(),
  }
  await putBottle(item)
  return json(200, toBottle(item, []), origin)
}

/** PUT /bottles/{id} (auth) body partial -> Bottle (404 if missing). */
export async function handleUpdateBottle(
  id: string,
  event: APIGatewayProxyEventV2,
  origin?: string,
): Promise<APIGatewayProxyResultV2> {
  const existing = await getBottleItem(id)
  if (!existing) return json(404, { error: 'bottle not found' }, origin)

  const raw = parseBody(event)
  if (typeof raw !== 'object' || raw === null) {
    return json(400, { error: 'invalid json' }, origin)
  }
  const r = raw as Record<string, unknown>

  // Whitelist-merge: only known fields, each validated; unknown keys ignored.
  const next: BottleItem = { ...existing }
  if (r.name !== undefined) {
    const v = str(r.name, 200)
    if (!v) return json(400, { error: 'invalid name' }, origin)
    next.name = v
  }
  if (r.producer !== undefined) {
    const v = str(r.producer, 200)
    if (!v) return json(400, { error: 'invalid producer' }, origin)
    next.producer = v
  }
  if (r.region !== undefined) {
    const v = str(r.region, 120)
    if (!v) return json(400, { error: 'invalid region' }, origin)
    next.region = v
  }
  if (r.type !== undefined) {
    const v = str(r.type, 60)
    if (!v) return json(400, { error: 'invalid type' }, origin)
    next.type_ = v
  }
  if (r.abv !== undefined) {
    const v = num(r.abv)
    if (v === undefined || v < 0 || v > 100) {
      return json(400, { error: 'abv must be 0..100' }, origin)
    }
    next.abv = v
  }
  if (r.price !== undefined) {
    if (r.price === null) {
      next.price = null
    } else {
      const v = num(r.price)
      if (v === undefined || v < 0) {
        return json(400, { error: 'price must be a non-negative number or null' }, origin)
      }
      next.price = v
    }
  }
  if (r.status !== undefined) {
    const v = status(r.status)
    if (!v) return json(400, { error: 'status must be cabinet, finished, or tasted' }, origin)
    next.status = v
  }
  // Per-type optional fields: empty/blank or null clears; otherwise the
  // trimmed value is set.
  if (r.grape !== undefined) {
    next.grape = r.grape === null ? undefined : str(r.grape, 120)
  }
  if (r.style !== undefined) {
    next.style = r.style === null ? undefined : str(r.style, 120)
  }
  if (r.roast !== undefined) {
    const v = r.roast === null ? undefined : str(r.roast, 120)
    next.roast = v === undefined ? undefined : normalizeRoast(v)
  }
  if (r.process !== undefined) {
    next.process = r.process === null ? undefined : str(r.process, 120)
  }

  await putBottle(next)
  const notes = await loadNotes(id)
  return json(200, toBottle(next, notes), origin)
}

/** DELETE /bottles/{id} (auth) -> 204 (also deletes its notes; 404 if missing). */
export async function handleDeleteBottle(
  id: string,
  origin?: string,
): Promise<APIGatewayProxyResultV2> {
  const deleted = await deleteBottleAndNotes(id)
  if (!deleted) return json(404, { error: 'bottle not found' }, origin)
  return noContent(origin)
}
