import { randomUUID } from 'node:crypto'
import type {
  APIGatewayProxyEventV2,
  APIGatewayProxyResultV2,
} from 'aws-lambda'
import { embedText } from './bedrock'
import { json } from './http'
import { getBottleItem, noteSk, putNote, toNote } from './store'
import {
  CORE_FLAVOR_AXES,
  FLAVOR_AXES,
  type FlavorTags,
  type NoteItem,
} from './types'

const str = (v: unknown, max: number, allowEmpty = false): string | undefined => {
  if (typeof v !== 'string') return undefined
  if (v.length > max) return undefined
  const t = v.trim()
  if (!allowEmpty && t.length === 0) return undefined
  return t
}

const num = (v: unknown): number | undefined =>
  typeof v === 'number' && Number.isFinite(v) ? v : undefined

/**
 * Validate flavor tags. The five CORE_FLAVOR_AXES are required (every client
 * ever shipped sends them); the newer axes are optional so a stale PWA client
 * that predates the 8-axis expansion can still log notes — absent axes are
 * simply not stored, and aggregation skips them.
 */
function parseFlavorTags(v: unknown): Partial<FlavorTags> | null {
  if (typeof v !== 'object' || v === null) return null
  const r = v as Record<string, unknown>
  const core = new Set<string>(CORE_FLAVOR_AXES)
  const out: Partial<FlavorTags> = {}
  for (const axis of FLAVOR_AXES) {
    if (r[axis] === undefined && !core.has(axis)) continue
    const n = num(r[axis])
    if (n === undefined || n < 0 || n > 5) return null
    out[axis] = n
  }
  return out
}

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

/**
 * POST /bottles/{id}/notes (auth) -> TastingNote.
 * Computes and stores a Titan embedding of nose+palate+finish synchronously.
 * If Bedrock is unavailable (access not enabled yet), the note is saved
 * WITHOUT an embedding — layer 2 simply excludes it until re-embedded.
 */
export async function handleCreateNote(
  bottleId: string,
  event: APIGatewayProxyEventV2,
  origin?: string,
): Promise<APIGatewayProxyResultV2> {
  const bottle = await getBottleItem(bottleId)
  if (!bottle) return json(404, { error: 'bottle not found' }, origin)

  const raw = parseBody(event)
  if (typeof raw !== 'object' || raw === null) {
    return json(400, { error: 'invalid json' }, origin)
  }
  const r = raw as Record<string, unknown>

  const nose = str(r.nose, 2000, true)
  const palate = str(r.palate, 2000, true)
  const finish = str(r.finish, 2000, true)
  const rating = num(r.rating)
  const flavorTags = parseFlavorTags(r.flavorTags)
  if (
    nose === undefined ||
    palate === undefined ||
    finish === undefined ||
    rating === undefined ||
    rating < 1 ||
    rating > 10 ||
    !flavorTags
  ) {
    return json(
      400,
      { error: 'nose, palate, finish, rating (1..10), flavorTags (0..5) required' },
      origin,
    )
  }

  const id = randomUUID()
  const createdAt = new Date().toISOString()

  // Embed synchronously; degrade soft on any Bedrock error.
  let embedding: number[] | undefined
  const embedInput = `${nose}\n${palate}\n${finish}`.trim()
  if (embedInput.length > 0) {
    try {
      embedding = await embedText(embedInput)
    } catch (err) {
      // AccessDenied (model access not enabled) or transient error: proceed
      // without the embedding. The structured layer still works.
      console.warn('titan embed failed, saving note without embedding:', err)
    }
  }

  const item: NoteItem = {
    pk: `BOTTLE#${bottleId}`,
    sk: noteSk(createdAt, id),
    type: 'note',
    id,
    bottleId,
    nose,
    palate,
    finish,
    rating: Math.round(rating),
    flavorTags,
    createdAt,
    embedding,
  }
  await putNote(item)
  return json(200, toNote(item), origin)
}
