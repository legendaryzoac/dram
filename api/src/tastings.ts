/**
 * Group tastings. The host (a signed-in user) opens a tasting and gets a short
 * code; for the next TASTING_TTL_HOURS anyone holding it can log tasting notes
 * against the host's bottles with no account. The code is the whole
 * credential — it rides in the path of the two public routes:
 *
 *   GET  /tastings/{code}                     -> TastingInvite   (public)
 *   POST /tastings/{code}/bottles/{id}/notes  -> TastingNote     (public)
 *   POST /tastings                            -> Tasting         (auth)
 *   GET  /tastings                            -> Tasting[]       (auth)
 *   DELETE /tastings/{code}                   -> Tasting         (auth, host only)
 *
 * What a code grants is deliberately narrow: create notes, nothing else.
 * Guests can't touch bottles, edit notes (theirs included — they have no
 * identity to prove), or make recommendation calls — the guest screen has no
 * recommendations or pairing, and pairing narration stays behind Cognito.
 * Their notes count like any other: embedded with Titan on write, and folded
 * into the bottle's profile, which the recommender reads.
 */
import { randomBytes, randomUUID } from 'node:crypto'
import type {
  APIGatewayProxyEventV2,
  APIGatewayProxyResultV2,
} from 'aws-lambda'
import { json } from './http'
import { embedNote, parseBody, parseNoteBody } from './notes'
import {
  claimTastingNote,
  endTastingItem,
  getBottleItem,
  getTastingItem,
  listTastingItems,
  noteSk,
  putNewTasting,
  putNote,
  tastingPk,
  toNote,
} from './store'
import {
  TASTING_LIMITS,
  TASTING_MAX_NOTES,
  TASTING_TTL_HOURS,
  type NoteItem,
  type Tasting,
  type TastingInvite,
  type TastingItem,
  type TastingStatus,
} from './types'

/** 32 symbols — digits and capitals minus 0/1/I/O, which read alike when
 *  someone's shouting the code across a table. 8 of them is 40 bits. */
const CODE_ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ'
export const CODE_LENGTH = 8

export function generateCode(): string {
  const bytes = randomBytes(CODE_LENGTH)
  let out = ''
  // 256 is a multiple of 32, so masking the low 5 bits is unbiased.
  for (const b of bytes) out += CODE_ALPHABET[b & 31]
  return out
}

/** "peat-7k2q" / "PEAT 7K2Q" -> "PEAT7K2Q"; null if it can't be a code. */
export function normalizeCode(raw: string | undefined): string | null {
  if (!raw) return null
  const c = decodeURIComponent(raw).toUpperCase().replace(/[^A-Z0-9]/g, '')
  if (c.length !== CODE_LENGTH) return null
  for (const ch of c) if (!CODE_ALPHABET.includes(ch)) return null
  return c
}

export function tastingStatus(item: TastingItem, now = new Date()): TastingStatus {
  if (item.endedAt) return 'ended'
  return item.expiresAt > now.toISOString() ? 'live' : 'expired'
}

function toTasting(item: TastingItem, now = new Date()): Tasting {
  return {
    id: item.id,
    code: item.code,
    label: item.label,
    createdAt: item.createdAt,
    expiresAt: item.expiresAt,
    endedAt: item.endedAt,
    status: tastingStatus(item, now),
    noteCount: item.noteCount,
  }
}

const GONE = { error: 'this tasting has ended' }
const UNKNOWN = { error: 'no tasting with that code' }

/** POST /tastings (auth) — open a tasting; body `{ label? }`. */
export async function handleCreateTasting(
  event: APIGatewayProxyEventV2,
  ownerSub: string,
  origin?: string,
): Promise<APIGatewayProxyResultV2> {
  const raw = event.body ? parseBody(event) : {}
  if (typeof raw !== 'object' || raw === null) {
    return json(400, { error: 'invalid body' }, origin)
  }
  const labelRaw = (raw as Record<string, unknown>).label
  if (labelRaw !== undefined && typeof labelRaw !== 'string') {
    return json(400, { error: 'label must be a string' }, origin)
  }
  const label = (labelRaw ?? '').trim()
  if (label.length > TASTING_LIMITS.label) {
    return json(400, { error: `label is at most ${TASTING_LIMITS.label} characters` }, origin)
  }

  const now = new Date()
  const expires = new Date(now.getTime() + TASTING_TTL_HOURS * 3_600_000)
  // Collisions are ~1 in 10^12 per live code; retry a couple of times anyway.
  for (let attempt = 0; attempt < 3; attempt++) {
    const code = generateCode()
    const item: TastingItem = {
      pk: tastingPk(code),
      sk: 'META',
      type: 'tasting',
      id: randomUUID(),
      code,
      label: label || 'Group tasting',
      ownerSub,
      createdAt: now.toISOString(),
      expiresAt: expires.toISOString(),
      noteCount: 0,
      // Swept by DynamoDB TTL a day after expiry; the notes themselves stay.
      ttl: Math.floor(expires.getTime() / 1000) + 86_400,
    }
    if (await putNewTasting(item)) return json(200, toTasting(item, now), origin)
  }
  return json(503, { error: 'could not allocate a code, try again' }, origin)
}

/** GET /tastings (auth) — the host's tastings, newest first. */
export async function handleListTastings(
  ownerSub: string,
  origin?: string,
): Promise<APIGatewayProxyResultV2> {
  const now = new Date()
  const items = await listTastingItems(ownerSub)
  const out = items
    .map((i) => toTasting(i, now))
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
  return json(200, out, origin)
}

/** DELETE /tastings/{code} (auth, host only) — end it now. The code stops
 *  working at once; notes already logged stay. */
export async function handleEndTasting(
  rawCode: string,
  ownerSub: string,
  origin?: string,
): Promise<APIGatewayProxyResultV2> {
  const code = normalizeCode(rawCode)
  if (!code) return json(404, UNKNOWN, origin)
  const item = await endTastingItem(code, ownerSub, new Date().toISOString())
  // Someone else's tasting reads as missing, not forbidden.
  if (!item) return json(404, UNKNOWN, origin)
  return json(200, toTasting(item), origin)
}

/** GET /tastings/{code} (public) — check a code before a guest starts. */
export async function handleGetTasting(
  rawCode: string,
  origin?: string,
): Promise<APIGatewayProxyResultV2> {
  const code = normalizeCode(rawCode)
  const item = code ? await getTastingItem(code) : null
  if (!item) return json(404, UNKNOWN, origin)
  if (tastingStatus(item) !== 'live') return json(410, GONE, origin)
  const invite: TastingInvite = {
    id: item.id,
    label: item.label,
    expiresAt: item.expiresAt,
  }
  return json(200, invite, origin)
}

/**
 * POST /tastings/{code}/bottles/{id}/notes (public) -> TastingNote.
 * The usual note body plus `taster` (the guest's name). Validation runs
 * before a slot is claimed so a bad body doesn't spend one.
 */
export async function handleCreateTastingNote(
  rawCode: string,
  bottleId: string,
  event: APIGatewayProxyEventV2,
  origin?: string,
): Promise<APIGatewayProxyResultV2> {
  const code = normalizeCode(rawCode)
  const tasting = code ? await getTastingItem(code) : null
  if (!code || !tasting) return json(404, UNKNOWN, origin)
  if (tastingStatus(tasting) !== 'live') return json(410, GONE, origin)

  const bottle = await getBottleItem(bottleId)
  if (!bottle) return json(404, { error: 'bottle not found' }, origin)

  const body = parseBody(event) as Record<string, unknown> | null
  const tasterRaw = body && typeof body === 'object' ? body.taster : undefined
  const taster = typeof tasterRaw === 'string' ? tasterRaw.trim() : ''
  if (taster.length === 0 || taster.length > TASTING_LIMITS.taster) {
    return json(
      400,
      { error: `taster (your name, 1..${TASTING_LIMITS.taster} characters) required` },
      origin,
    )
  }
  const parsed = parseNoteBody(event)
  if (!parsed) {
    return json(
      400,
      { error: 'nose, palate, finish, rating (1..10), flavorTags (0..5) required' },
      origin,
    )
  }

  const nowIso = new Date().toISOString()
  if (!(await claimTastingNote(code, nowIso, TASTING_MAX_NOTES))) {
    // Ended or expired between the read and now, or at the cap.
    const fresh = await getTastingItem(code)
    if (fresh && tastingStatus(fresh) === 'live') {
      return json(429, { error: 'this tasting has hit its note limit' }, origin)
    }
    return json(410, GONE, origin)
  }

  const id = randomUUID()
  const item: NoteItem = {
    pk: `BOTTLE#${bottleId}`,
    sk: noteSk(nowIso, id),
    type: 'note',
    id,
    bottleId,
    ...parsed,
    createdAt: nowIso,
    // Synthetic author: no Cognito sub ever equals it, so nobody can edit or
    // claim a guest's note through PUT.
    authorSub: `tasting:${tasting.id}`,
    taster,
    tastingId: tasting.id,
    embedding: await embedNote(parsed),
  }
  await putNote(item)
  return json(200, toNote(item), origin)
}
