import {
  DeleteCommand,
  GetCommand,
  PutCommand,
  QueryCommand,
  ScanCommand,
} from '@aws-sdk/lib-dynamodb'
import { TABLE_NAME, ddb } from './db'
import {
  FLAVOR_AXES,
  type Bottle,
  type BottleItem,
  type FlavorTags,
  type NoteItem,
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
  const sum: FlavorTags = { sweet: 0, smoky: 0, fruity: 0, oaky: 0, spicy: 0 }
  for (const n of notes) {
    for (const axis of FLAVOR_AXES) sum[axis] += n.flavorTags[axis]
  }
  const out = {} as FlavorTags
  for (const axis of FLAVOR_AXES) {
    // Round to 1 dp — enough for a radar chart, avoids float noise on the wire.
    out[axis] = Math.round((sum[axis] / notes.length) * 10) / 10
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
    grape: item.grape,
    createdAt: item.createdAt,
    avgRating: averageRating(notes),
    flavorProfile: averageFlavor(notes),
    noteCount: notes.length,
  }
}

export function toNote(item: NoteItem): TastingNote {
  // Deliberately omits `embedding` — it is stored but never returned.
  return {
    id: item.id,
    bottleId: item.bottleId,
    nose: item.nose,
    palate: item.palate,
    finish: item.finish,
    rating: item.rating,
    flavorTags: item.flavorTags,
    createdAt: item.createdAt,
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
