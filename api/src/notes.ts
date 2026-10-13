import { randomUUID } from 'node:crypto'
import type {
  APIGatewayProxyEventV2,
  APIGatewayProxyResultV2,
} from 'aws-lambda'
import { embedText } from './bedrock'
import { json } from './http'
import {
  getBottleItem,
  listNoteItems,
  loadNotes,
  noteSk,
  putNote,
  toNote,
} from './store'
import {
  CORE_FLAVOR_AXES,
  FLAVOR_AXES,
  type FlavorTags,
  type NoteBrew,
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

const BREW_FIELDS = ['grinder', 'method', 'grindSize', 'ratio', 'time'] as const

/**
 * Optional brew metadata (coffee notes). Absent/blank fields are dropped;
 * an object with nothing in it stores nothing. Returns null on invalid input
 * (non-object, or a field that isn't a short string).
 */
function parseBrew(v: unknown): NoteBrew | null | undefined {
  if (v === undefined || v === null) return undefined
  if (typeof v !== 'object') return null
  const r = v as Record<string, unknown>
  const out: NoteBrew = {}
  for (const field of BREW_FIELDS) {
    if (r[field] === undefined || r[field] === null) continue
    if (typeof r[field] !== 'string' || (r[field] as string).length > 80) {
      return null
    }
    const t = (r[field] as string).trim()
    if (t !== '') out[field] = t
  }
  return Object.keys(out).length > 0 ? out : undefined
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

interface ParsedNote {
  nose: string
  palate: string
  finish: string
  rating: number
  flavorTags: Partial<FlavorTags>
  brew?: NoteBrew
}

/** Shared body validation for note create + edit. Null => 400. */
function parseNoteBody(event: APIGatewayProxyEventV2): ParsedNote | null {
  const raw = parseBody(event)
  if (typeof raw !== 'object' || raw === null) return null
  const r = raw as Record<string, unknown>

  const nose = str(r.nose, 2000, true)
  const palate = str(r.palate, 2000, true)
  const finish = str(r.finish, 2000, true)
  const rating = num(r.rating)
  const flavorTags = parseFlavorTags(r.flavorTags)
  const brew = parseBrew(r.brew)
  if (
    nose === undefined ||
    palate === undefined ||
    finish === undefined ||
    rating === undefined ||
    rating < 1 ||
    rating > 10 ||
    !flavorTags ||
    brew === null
  ) {
    return null
  }
  return { nose, palate, finish, rating: Math.round(rating), flavorTags, brew }
}

/** Titan embedding of the prose, fail-soft: undefined when Bedrock is out. */
async function embedNote(parsed: ParsedNote): Promise<number[] | undefined> {
  const input = `${parsed.nose}\n${parsed.palate}\n${parsed.finish}`.trim()
  if (input.length === 0) return undefined
  try {
    return await embedText(input)
  } catch (err) {
    // AccessDenied (model access not enabled) or transient error: proceed
    // without the embedding. The structured layer still works.
    console.warn('titan embed failed, saving note without embedding:', err)
    return undefined
  }
}

/**
 * POST /bottles/{id}/notes (auth) -> TastingNote.
 * Computes and stores a Titan embedding of nose+palate+finish synchronously,
 * and records the caller as the note's author for later edit checks.
 */
/**
 * GET /notes — every tasting note in the corpus, newest first: the hub's one
 * read for the drinker's whole history (a public read, like the bottles).
 */
export async function handleListNotes(
  origin?: string,
): Promise<APIGatewayProxyResultV2> {
  const items = await listNoteItems()
  const all = items.map(toNote).sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
  return json(200, all, origin)
}

export async function handleCreateNote(
  bottleId: string,
  event: APIGatewayProxyEventV2,
  authorSub: string,
  origin?: string,
): Promise<APIGatewayProxyResultV2> {
  const bottle = await getBottleItem(bottleId)
  if (!bottle) return json(404, { error: 'bottle not found' }, origin)

  const parsed = parseNoteBody(event)
  if (!parsed) {
    return json(
      400,
      { error: 'nose, palate, finish, rating (1..10), flavorTags (0..5) required' },
      origin,
    )
  }

  const id = randomUUID()
  const createdAt = new Date().toISOString()
  const embedding = await embedNote(parsed)

  const item: NoteItem = {
    pk: `BOTTLE#${bottleId}`,
    sk: noteSk(createdAt, id),
    type: 'note',
    id,
    bottleId,
    ...parsed,
    createdAt,
    authorSub,
    embedding,
  }
  await putNote(item)
  return json(200, toNote(item), origin)
}

/**
 * PUT /bottles/{id}/notes/{noteId} (auth) -> TastingNote.
 * Only the note's author may edit it; pre-attribution notes (no authorSub)
 * are claimed by their first editor. The embedding is recomputed from the
 * new prose — on Bedrock failure it is dropped rather than left stale.
 */
export async function handleUpdateNote(
  bottleId: string,
  noteId: string,
  event: APIGatewayProxyEventV2,
  editorSub: string,
  origin?: string,
): Promise<APIGatewayProxyResultV2> {
  const notes = await loadNotes(bottleId)
  const existing = notes.find((n) => n.id === noteId)
  if (!existing) return json(404, { error: 'note not found' }, origin)

  if (existing.authorSub && existing.authorSub !== editorSub) {
    return json(403, { error: 'you can only edit your own notes' }, origin)
  }

  const parsed = parseNoteBody(event)
  if (!parsed) {
    return json(
      400,
      { error: 'nose, palate, finish, rating (1..10), flavorTags (0..5) required' },
      origin,
    )
  }

  const embedding = await embedNote(parsed)

  // Same pk/sk (the sort key is anchored to createdAt), new content.
  const item: NoteItem = {
    ...existing,
    ...parsed,
    // parseNoteBody omits brew when empty — spread keeps the old one, so
    // clear it explicitly: an edit's brew is a full replacement.
    brew: parsed.brew,
    updatedAt: new Date().toISOString(),
    authorSub: existing.authorSub ?? editorSub,
    embedding,
  }
  await putNote(item)
  return json(200, toNote(item), origin)
}
