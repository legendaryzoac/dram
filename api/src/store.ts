import {
  DeleteCommand,
  GetCommand,
  PutCommand,
  QueryCommand,
  ScanCommand,
  UpdateCommand,
} from '@aws-sdk/lib-dynamodb'
import { TABLE_NAME, ddb } from './db'
import {
  FLAVOR_AXES,
  normalizeRoast,
  type Bottle,
  type BottleItem,
  type FlavorTags,
  type NoteItem,
  type TastingItem,
  type TastingNote,
} from './types'

// ---- key helpers ----
// Single table. A bottle and all its notes share PK=BOTTLE#<id>, so one Query
// by PK returns the bottle META row plus every NOTE row in a single round trip.
export const bottlePk = (id: string) => `BOTTLE#${id}`
export const BOTTLE_SK = 'META' as const
export const noteSk = (createdAt: string, id: string) =>
  `NOTE#${createdAt}#${id}`

// ---- projections: storage item -> wire shape ----

function averageFlavor(notes: NoteItem[]): FlavorTags | null {
  if (notes.length === 0) return null
  const out = {} as FlavorTags
  for (const axis of FLAVOR_AXES) {
    // Average each axis over the notes that measured it — pre-expansion notes
    // lack the newer axes and shouldn't drag them toward zero. An axis no note
    // measured reads 0 on the wire.
    let sum = 0
    let count = 0
    for (const n of notes) {
      const v = n.flavorTags[axis]
      if (typeof v === 'number') {
        sum += v
        count += 1
      }
    }
    // Round to 1 dp — enough for a radar chart, avoids float noise on the wire.
    out[axis] = count === 0 ? 0 : Math.round((sum / count) * 10) / 10
  }
  return out
}

function averageRating(notes: NoteItem[]): number | null {
  if (notes.length === 0) return null
  const total = notes.reduce((acc, n) => acc + n.rating, 0)
  return Math.round((total / notes.length) * 10) / 10
}

/** Compose the wire Bottle, folding in server-computed aggregates from notes. */
export function toBottle(item: BottleItem, notes: NoteItem[]): Bottle {
  return {
    id: item.id,
    name: item.name,
    producer: item.producer,
    region: item.region,
    type: item.type_,
    abv: item.abv,
    price: item.price,
    status: item.status ?? 'cabinet',
    grape: item.grape,
    style: item.style,
    // Normalized on read too, so items stored before canonicalization
    // ("Light") don't fork the roast filter against new ones ("light").
    roast: item.roast === undefined ? undefined : normalizeRoast(item.roast),
    process: item.process,
    createdAt: item.createdAt,
    avgRating: averageRating(notes),
    flavorProfile: averageFlavor(notes),
    noteCount: notes.length,
  }
}

export function toNote(item: NoteItem): TastingNote {
  // Pre-expansion notes lack the newer axes; fill them with 0 so the wire
  // shape is always a complete FlavorTags.
  const flavorTags = {} as FlavorTags
  for (const axis of FLAVOR_AXES) flavorTags[axis] = item.flavorTags[axis] ?? 0
  // Deliberately omits `embedding` and `authorSub` — stored, never returned.
  // `taster` and `tastingId` are public; the tasting's code never touches a
  // note, since GET /notes is a public read.
  return {
    id: item.id,
    bottleId: item.bottleId,
    nose: item.nose,
    palate: item.palate,
    finish: item.finish,
    rating: item.rating,
    flavorTags,
    brew: item.brew,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
    taster: item.taster,
    tastingId: item.tastingId,
  }
}

// ---- reads ----

/**
 * All bottles. GET /bottles is a Scan filtered to META rows: at personal scale
 * (dozens to low hundreds of bottles) a Scan is cheaper and simpler than
 * maintaining a GSI, and the note rows are skipped by the filter.
 */
export async function listBottleItems(): Promise<BottleItem[]> {
  const items: BottleItem[] = []
  let lastKey: Record<string, unknown> | undefined
  do {
    const res = await ddb.send(
      new ScanCommand({
        TableName: TABLE_NAME,
        FilterExpression: '#t = :bottle',
        ExpressionAttributeNames: { '#t': 'type' },
        ExpressionAttributeValues: { ':bottle': 'bottle' },
        ExclusiveStartKey: lastKey,
      }),
    )
    items.push(...((res.Items ?? []) as BottleItem[]))
    lastKey = res.LastEvaluatedKey
  } while (lastKey)
  return items
}

/**
 * Every tasting note in the corpus: one Scan filtered to note rows. The hub
 * reads the drinker's whole history in one call (GET /notes) instead of one
 * per bottle, and the bottle list joins notes to bottles from this one read.
 */
export async function listNoteItems(): Promise<NoteItem[]> {
  const items: NoteItem[] = []
  let lastKey: Record<string, unknown> | undefined
  do {
    const res = await ddb.send(
      new ScanCommand({
        TableName: TABLE_NAME,
        FilterExpression: '#t = :note',
        ExpressionAttributeNames: { '#t': 'type' },
        ExpressionAttributeValues: { ':note': 'note' },
        ExclusiveStartKey: lastKey,
      }),
    )
    items.push(...((res.Items ?? []) as NoteItem[]))
    lastKey = res.LastEvaluatedKey
  } while (lastKey)
  return items
}

/** Notes keyed by the bottle they belong to. */
export function groupNotes(items: NoteItem[]): Map<string, NoteItem[]> {
  const byBottle = new Map<string, NoteItem[]>()
  for (const n of items) {
    const arr = byBottle.get(n.bottleId)
    if (arr) arr.push(n)
    else byBottle.set(n.bottleId, [n])
  }
  return byBottle
}

/** A single bottle META row plus all of its notes, via one PK Query. */
export async function loadBottleWithNotes(
  id: string,
): Promise<{ bottle: BottleItem; notes: NoteItem[] } | null> {
  const res = await ddb.send(
    new QueryCommand({
      TableName: TABLE_NAME,
      KeyConditionExpression: 'pk = :pk',
      ExpressionAttributeValues: { ':pk': bottlePk(id) },
    }),
  )
  const rows = res.Items ?? []
  const bottle = rows.find((r) => r.sk === BOTTLE_SK) as BottleItem | undefined
  if (!bottle) return null
  const notes = rows.filter((r) => r.sk !== BOTTLE_SK) as NoteItem[]
  return { bottle, notes }
}

/** Just the notes for a bottle (used by the recommender to build vectors). */
export async function loadNotes(id: string): Promise<NoteItem[]> {
  const res = await ddb.send(
    new QueryCommand({
      TableName: TABLE_NAME,
      KeyConditionExpression: 'pk = :pk AND begins_with(sk, :prefix)',
      ExpressionAttributeValues: { ':pk': bottlePk(id), ':prefix': 'NOTE#' },
    }),
  )
  return (res.Items ?? []) as NoteItem[]
}

// ---- writes ----

export async function putBottle(item: BottleItem): Promise<void> {
  await ddb.send(new PutCommand({ TableName: TABLE_NAME, Item: item }))
}

export async function getBottleItem(id: string): Promise<BottleItem | null> {
  const res = await ddb.send(
    new GetCommand({
      TableName: TABLE_NAME,
      Key: { pk: bottlePk(id), sk: BOTTLE_SK },
    }),
  )
  return (res.Item as BottleItem | undefined) ?? null
}

export async function putNote(item: NoteItem): Promise<void> {
  await ddb.send(new PutCommand({ TableName: TABLE_NAME, Item: item }))
}

/** Delete a bottle and every one of its notes (one Query, then batched deletes). */
export async function deleteBottleAndNotes(id: string): Promise<boolean> {
  const res = await ddb.send(
    new QueryCommand({
      TableName: TABLE_NAME,
      KeyConditionExpression: 'pk = :pk',
      ExpressionAttributeValues: { ':pk': bottlePk(id) },
      ProjectionExpression: 'pk, sk',
    }),
  )
  const rows = res.Items ?? []
  if (rows.length === 0) return false
  // Personal scale: a handful of rows per bottle. Individual deletes keep the
  // code simple and stay well within Lambda's time budget.
  for (const row of rows) {
    await ddb.send(
      new DeleteCommand({
        TableName: TABLE_NAME,
        Key: { pk: row.pk, sk: row.sk },
      }),
    )
  }
  return true
}

// ---- group tastings ----

export const tastingPk = (code: string) => `TASTING#${code}`

/** Write a new tasting; false if the code is already taken (retry another). */
export async function putNewTasting(item: TastingItem): Promise<boolean> {
  try {
    await ddb.send(
      new PutCommand({
        TableName: TABLE_NAME,
        Item: item,
        ConditionExpression: 'attribute_not_exists(pk)',
      }),
    )
    return true
  } catch (err) {
    if (isConditionFailure(err)) return false
    throw err
  }
}

export async function getTastingItem(code: string): Promise<TastingItem | null> {
  const res = await ddb.send(
    new GetCommand({
      TableName: TABLE_NAME,
      Key: { pk: tastingPk(code), sk: BOTTLE_SK },
    }),
  )
  return (res.Item as TastingItem | undefined) ?? null
}

/** The host's tastings (a filtered Scan — rows are TTL-swept, so few). */
export async function listTastingItems(ownerSub: string): Promise<TastingItem[]> {
  const items: TastingItem[] = []
  let lastKey: Record<string, unknown> | undefined
  do {
    const res = await ddb.send(
      new ScanCommand({
        TableName: TABLE_NAME,
        FilterExpression: '#t = :tasting AND ownerSub = :sub',
        ExpressionAttributeNames: { '#t': 'type' },
        ExpressionAttributeValues: { ':tasting': 'tasting', ':sub': ownerSub },
        ExclusiveStartKey: lastKey,
      }),
    )
    items.push(...((res.Items ?? []) as TastingItem[]))
    lastKey = res.LastEvaluatedKey
  } while (lastKey)
  return items
}

/**
 * Take one note slot on a tasting, atomically: succeeds only while the
 * tasting is live (not ended, not past expiresAt) and under `max` notes.
 * The check and the count are one conditional update, so two guests racing
 * past the cap, or a note landing as the host ends it, can't slip through.
 */
export async function claimTastingNote(
  code: string,
  nowIso: string,
  max: number,
): Promise<boolean> {
  try {
    await ddb.send(
      new UpdateCommand({
        TableName: TABLE_NAME,
        Key: { pk: tastingPk(code), sk: BOTTLE_SK },
        UpdateExpression: 'ADD noteCount :one',
        ConditionExpression:
          'attribute_exists(pk) AND expiresAt > :now AND attribute_not_exists(endedAt) AND noteCount < :max',
        ExpressionAttributeValues: { ':one': 1, ':now': nowIso, ':max': max },
      }),
    )
    return true
  } catch (err) {
    if (isConditionFailure(err)) return false
    throw err
  }
}

/** End a tasting early. Only its host may; false when not theirs/missing. */
export async function endTastingItem(
  code: string,
  ownerSub: string,
  nowIso: string,
): Promise<TastingItem | null> {
  try {
    const res = await ddb.send(
      new UpdateCommand({
        TableName: TABLE_NAME,
        Key: { pk: tastingPk(code), sk: BOTTLE_SK },
        UpdateExpression: 'SET endedAt = if_not_exists(endedAt, :now)',
        ConditionExpression: 'attribute_exists(pk) AND ownerSub = :sub',
        ExpressionAttributeValues: { ':now': nowIso, ':sub': ownerSub },
        ReturnValues: 'ALL_NEW',
      }),
    )
    return (res.Attributes as TastingItem | undefined) ?? null
  } catch (err) {
    if (isConditionFailure(err)) return null
    throw err
  }
}

function isConditionFailure(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    (err as { name?: string }).name === 'ConditionalCheckFailedException'
  )
}
