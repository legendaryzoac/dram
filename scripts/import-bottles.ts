/**
 * One-off cabinet import.
 *
 * Writes the bottles in a JSON file straight into the DramSite DynamoDB table,
 * in exactly the shape the API's POST /bottles writes (see api/src/bottles.ts),
 * and skips any name already in the cabinet. It runs with your local AWS
 * credentials — the same ones `cdk deploy` uses — so no Cognito sign-in is
 * needed, and it never touches notes.
 *
 *   npm run import:bottles                         # dry run: what would be added
 *   npm run import:bottles -- --apply              # write
 *   npm run import:bottles -- --file other.json --apply
 *   npm run import:bottles -- --table <TableName>  # if more than one DramSite table is found
 *   npm run import:bottles -- --validate-only      # check the file, no AWS calls
 *
 * The file is an array of { name, producer, region, type, abv, style?, price?,
 * count?, verify? }. `count` and `verify` are notes to you — a multiple on your
 * shelf, a value to double-check — and are printed, never stored.
 */
import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { DynamoDBClient, ListTablesCommand } from '@aws-sdk/client-dynamodb'
import {
  DynamoDBDocumentClient,
  PutCommand,
  ScanCommand,
} from '@aws-sdk/lib-dynamodb'
import type { BottleItem } from '../api/src/types'

interface ImportEntry {
  name: string
  producer: string
  region: string
  type: string
  abv: number
  style?: string
  price?: number | null
  count?: number
  verify?: string
}

const args = process.argv.slice(2)
const flag = (name: string) => args.includes(name)
const option = (name: string): string | undefined => {
  const i = args.indexOf(name)
  return i === -1 ? undefined : args[i + 1]
}

const APPLY = flag('--apply')
const VALIDATE_ONLY = flag('--validate-only')
const FILE = resolve(option('--file') ?? 'scripts/cabinet-import.json')
const REGION = process.env.AWS_REGION ?? 'us-east-1'

// ---- load + validate, mirroring the API's limits ----

function fail(msg: string): never {
  console.error(`✗ ${msg}`)
  process.exit(1)
}

function loadEntries(file: string): ImportEntry[] {
  let raw: unknown
  try {
    raw = JSON.parse(readFileSync(file, 'utf8'))
  } catch (e) {
    fail(`could not read ${file}: ${(e as Error).message}`)
  }
  if (!Array.isArray(raw)) fail(`${file} must be a JSON array`)
  const seen = new Set<string>()
  return raw.map((r, i) => {
    const e = r as Partial<ImportEntry>
    const where = `entry ${i + 1}${e.name ? ` (${e.name})` : ''}`
    const str = (v: unknown, max: number, what: string) => {
      if (typeof v !== 'string' || v.trim() === '' || v.length > max) {
        fail(`${where}: ${what} must be a non-empty string of at most ${max} chars`)
      }
      return (v as string).trim()
    }
    const name = str(e.name, 200, 'name')
    const key = normalize(name)
    if (seen.has(key)) fail(`${where}: duplicate name in the file`)
    seen.add(key)
    if (typeof e.abv !== 'number' || !Number.isFinite(e.abv) || e.abv < 0 || e.abv > 100) {
      fail(`${where}: abv must be a number 0..100`)
    }
    if (e.price != null && (typeof e.price !== 'number' || e.price < 0)) {
      fail(`${where}: price must be a non-negative number or null`)
    }
    return {
      name,
      producer: str(e.producer, 200, 'producer'),
      region: str(e.region, 120, 'region'),
      type: str(e.type, 60, 'type').toLowerCase(),
      abv: e.abv,
      style: e.style === undefined || e.style === null ? undefined : str(e.style, 120, 'style'),
      price: e.price ?? null,
      count: e.count,
      verify: e.verify,
    }
  })
}

/** Lowercase, accents folded, punctuation collapsed — so "Maker's Mark 46"
 *  and "makers mark 46" are one bottle. */
function normalize(s: string): string {
  return s
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

// ---- AWS ----

async function findTable(client: DynamoDBClient): Promise<string> {
  const explicit = option('--table')
  if (explicit) return explicit
  const names: string[] = []
  let start: string | undefined
  do {
    const res = await client.send(new ListTablesCommand({ ExclusiveStartTableName: start }))
    names.push(...(res.TableNames ?? []))
    start = res.LastEvaluatedTableName
  } while (start)
  const matches = names.filter((n) => n.startsWith('DramSite-DataTable'))
  if (matches.length === 1) return matches[0]
  if (matches.length === 0) fail(`no DramSite-DataTable* table in ${REGION}; pass --table <name>`)
  fail(`several candidate tables (${matches.join(', ')}); pass --table <name>`)
}

async function existingNames(ddb: DynamoDBDocumentClient, table: string): Promise<Map<string, string>> {
  const out = new Map<string, string>()
  let lastKey: Record<string, unknown> | undefined
  do {
    const res = await ddb.send(
      new ScanCommand({
        TableName: table,
        FilterExpression: '#t = :bottle',
        ProjectionExpression: '#n',
        ExpressionAttributeNames: { '#t': 'type', '#n': 'name' },
        ExpressionAttributeValues: { ':bottle': 'bottle' },
        ExclusiveStartKey: lastKey,
      }),
    )
    for (const row of res.Items ?? []) {
      const name = row.name as string
      out.set(normalize(name), name)
    }
    lastKey = res.LastEvaluatedKey
  } while (lastKey)
  return out
}

function toItem(e: ImportEntry, createdAt: string): BottleItem {
  const id = randomUUID()
  return {
    pk: `BOTTLE#${id}`,
    sk: 'META',
    type: 'bottle',
    id,
    name: e.name,
    producer: e.producer,
    region: e.region,
    type_: e.type,
    abv: e.abv,
    price: e.price ?? null,
    style: e.style,
    createdAt,
  }
}

// ---- main ----

async function main() {
  const entries = loadEntries(FILE)
  const bottles = entries.reduce((n, e) => n + (e.count ?? 1), 0)
  console.log(`${entries.length} labels (${bottles} bottles counting multiples) in ${FILE}`)
  if (VALIDATE_ONLY) {
    report(entries)
    console.log('✓ file is valid')
    return
  }

  const client = new DynamoDBClient({ region: REGION })
  const ddb = DynamoDBDocumentClient.from(client, {
    marshallOptions: { removeUndefinedValues: true },
  })
  const table = await findTable(client)
  const existing = await existingNames(ddb, table)
  console.log(`table ${table} · ${existing.size} bottles already in the cabinet`)

  const toAdd = entries.filter((e) => !existing.has(normalize(e.name)))
  const skipped = entries.filter((e) => existing.has(normalize(e.name)))
  for (const e of skipped) console.log(`  skip  ${e.name}  (already there as “${existing.get(normalize(e.name))}”)`)
  for (const e of toAdd) console.log(`  add   ${e.name}  — ${e.type} · ${e.region} · ${e.abv}%`)
  report(entries)

  if (!APPLY) {
    console.log(`\nDry run: ${toAdd.length} to add, ${skipped.length} skipped. Re-run with --apply to write.`)
    return
  }

  // Newest-first list order follows the file: the first entry gets the latest
  // createdAt, each next one a second earlier.
  const now = Date.now()
  let added = 0
  for (const [i, e] of toAdd.entries()) {
    const item = toItem(e, new Date(now - i * 1000).toISOString())
    await ddb.send(
      new PutCommand({
        TableName: table,
        Item: item,
        ConditionExpression: 'attribute_not_exists(pk)',
      }),
    )
    added += 1
  }
  console.log(`\n✓ added ${added}, skipped ${skipped.length} already present.`)
}

function report(entries: ImportEntry[]) {
  const multiples = entries.filter((e) => (e.count ?? 1) > 1)
  if (multiples.length) {
    console.log('\nMultiples on your shelf (one entry each; the cabinet has no quantity field):')
    for (const e of multiples) console.log(`  ×${e.count}  ${e.name}`)
  }
  const verify = entries.filter((e) => e.verify)
  if (verify.length) {
    console.log('\nPlease check these against your labels:')
    for (const e of verify) console.log(`  ${e.name} (${e.abv}%) — ${e.verify}`)
  }
}

main().catch((e) => {
  console.error('✗', e instanceof Error ? e.message : e)
  process.exit(1)
})
