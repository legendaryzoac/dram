import type {
  APIGatewayProxyEventV2,
  APIGatewayProxyResultV2,
} from 'aws-lambda'
import { narratePairing } from './bedrock'
import { json } from './http'
import { avgRating, topHighlights, type CorpusBottle } from './recommender'
import { listBottleItems, loadNotes } from './store'
import {
  PAIRING_LIMITS,
  familyOf,
  type CigarStrength,
  type PairingNarration,
} from './types'

/**
 * POST /pairings (auth) -> PairingNarration.
 *
 * The web client does the structured pairing itself (dish/cigar -> target
 * flavor profile -> ranked cabinet). This endpoint adds the narrated layer:
 * Haiku reasons over the occasion and the drinker's *whole* cabinet, so it
 * can confirm the client's shortlist or reach for a bottle the flavor math
 * missed. It is called only when the drinker submits a pairing, and it fails
 * soft — Bedrock trouble yields `{ narration: null, degraded: true }`.
 */

const STRENGTHS: ReadonlySet<string> = new Set(['mild', 'medium', 'full'])
const MAX_TEXT = PAIRING_LIMITS.text
const MAX_FIELD = PAIRING_LIMITS.field
const MAX_WRAPPER = PAIRING_LIMITS.wrapper
const MAX_CANDIDATES = PAIRING_LIMITS.candidates
const MAX_CANDIDATE_ID = 64
/** Cap on cabinet lines in the prompt — a big cabinet stays a small prompt. */
const MAX_CABINET_LINES = 40
const MAX_NOTE_CHARS = 90

export type ParsedPairing =
  | { kind: 'food'; text: string; reading?: string; candidateIds: string[] }
  | {
      kind: 'cigar'
      brand?: string
      line?: string
      strength: CigarStrength
      wrapper?: string
      candidateIds: string[]
    }

const str = (v: unknown, max: number): string | undefined =>
  typeof v === 'string' && v.trim().length > 0 && v.length <= max
    ? v.trim()
    : undefined

/** Optional short string: absent/null/blank -> undefined; present but not a
 *  short string -> null (invalid). */
function optional(v: unknown, max: number): string | null | undefined {
  if (v === undefined || v === null) return undefined
  if (typeof v !== 'string' || v.length > max) return null
  const t = v.trim()
  return t === '' ? undefined : t
}

function parseCandidateIds(v: unknown): string[] | null {
  if (v === undefined || v === null) return []
  if (!Array.isArray(v) || v.length > MAX_CANDIDATES) return null
  const out: string[] = []
  for (const id of v) {
    if (typeof id !== 'string' || id.length === 0 || id.length > MAX_CANDIDATE_ID) {
      return null
    }
    out.push(id)
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

/** Validate a POST /pairings body. Null => 400. */
export function parsePairingBody(raw: unknown): ParsedPairing | null {
  if (typeof raw !== 'object' || raw === null) return null
  const r = raw as Record<string, unknown>
  const candidateIds = parseCandidateIds(r.candidateIds)
  if (candidateIds === null) return null

  if (r.kind === 'food') {
    const text = str(r.text, MAX_TEXT)
    const reading = optional(r.reading, MAX_FIELD)
    if (!text || reading === null) return null
    return { kind: 'food', text, reading, candidateIds }
  }
  if (r.kind === 'cigar') {
    if (typeof r.strength !== 'string' || !STRENGTHS.has(r.strength)) return null
    const brand = optional(r.brand, MAX_FIELD)
    const line = optional(r.line, MAX_FIELD)
    const wrapper = optional(r.wrapper, MAX_WRAPPER)
    if (brand === null || line === null || wrapper === null) return null
    return {
      kind: 'cigar',
      brand,
      line,
      strength: r.strength as CigarStrength,
      wrapper,
      candidateIds,
    }
  }
  return null
}

/** One line for the prompt: what they're having. */
export function describeOccasion(p: ParsedPairing): string {
  if (p.kind === 'food') {
    const reading = p.reading
      ? ` (the app's flavor-math read it as: ${p.reading})`
      : ''
    return `food — "${p.text}"${reading}`
  }
  const name = [p.brand, p.line].filter(Boolean).join(' ') || 'an unnamed cigar'
  const wrapper = p.wrapper ? ` · wrapper: ${p.wrapper}` : ''
  return `a cigar — ${name} · strength: ${p.strength}${wrapper}`
}

function truncate(s: string, max: number): string {
  return s.length <= max ? s : `${s.slice(0, max - 1).trimEnd()}…`
}

/** The pairing candidates: coffee is logged beside the cabinet but is never
 *  what gets poured with the steak or the cigar. */
export function cabinetOnly(corpus: CorpusBottle[]): CorpusBottle[] {
  return corpus.filter((b) => familyOf(b.item.type_) === 'alcohol')
}

/**
 * The cabinet as prompt context: best-rated first with unrated bottles
 * last, capped so a big cabinet stays a small prompt. Bottles in `keep`
 * (the client's shortlist) always make the cut, since the prompt forbids
 * naming anything outside this block. Each line carries the drinker's top
 * note for that bottle so the model reasons from their palate, not just
 * the label.
 */
export function cabinetLines(
  cabinet: CorpusBottle[],
  max = MAX_CABINET_LINES,
  keep: ReadonlySet<string> = new Set(),
): string[] {
  const ranked = cabinet
    .map((b) => ({ b, rating: avgRating(b.notes) }))
    .sort(
      (x, y) =>
        (y.rating ?? -1) - (x.rating ?? -1) ||
        x.b.item.name.localeCompare(y.b.item.name),
    )
  const kept = ranked.filter(({ b }) => keep.has(b.item.id))
  const rest = ranked
    .filter(({ b }) => !keep.has(b.item.id))
    .slice(0, Math.max(0, max - kept.length))
  const chosen = new Set([...kept, ...rest].map(({ b }) => b.item.id))
  return ranked
    .filter(({ b }) => chosen.has(b.item.id))
    .map(({ b, rating }) => {
      const { item } = b
      const top = b.notes.slice().sort((a, c) => c.rating - a.rating)[0]
      const note = top
        ? truncate((top.palate || top.nose || top.finish).trim(), MAX_NOTE_CHARS)
        : ''
      const style = item.style ? `, ${item.style}` : ''
      const rated =
        rating === null ? 'unrated' : `rated ${Math.round(rating * 10) / 10}/10`
      return (
        `${item.name} — ${item.type_}${style}, ${item.region}, ${item.abv}% · ${rated}` +
        (note ? ` · "${note}"` : '')
      )
    })
}

export async function handlePairing(
  event: APIGatewayProxyEventV2,
  origin?: string,
): Promise<APIGatewayProxyResultV2> {
  const parsed = parsePairingBody(parseBody(event))
  if (!parsed) {
    return json(
      400,
      {
        error:
          'kind "food" with text (<=200 chars), or kind "cigar" with strength (mild|medium|full), required',
      },
      origin,
    )
  }

  // Notes load in parallel: personal scale, dozens of small Queries.
  const items = await listBottleItems()
  const cabinet = cabinetOnly(
    await Promise.all(
      items.map(async (item) => ({ item, notes: await loadNotes(item.id) })),
    ),
  )

  // The shortlist comes back by name from the cabinet, never from the
  // client: unknown ids (and coffee) are simply dropped.
  const nameById = new Map(cabinet.map((b) => [b.item.id, b.item.name]))
  const keep = new Set(parsed.candidateIds.filter((id) => nameById.has(id)))
  const shortlist = [...keep].map((id) => nameById.get(id)!)

  try {
    const narration = await narratePairing({
      occasion: describeOccasion(parsed),
      kindWord: parsed.kind === 'food' ? 'dish' : 'cigar',
      cabinet: cabinetLines(cabinet, MAX_CABINET_LINES, keep),
      shortlist,
      // Favourites from the cabinet only, so a loved coffee never steers a
      // pairing toward something that can't be poured.
      highlights: topHighlights(cabinet),
    })
    return json(200, { narration, degraded: false } satisfies PairingNarration, origin)
  } catch (err) {
    // AccessDenied (model access not enabled) or a transient Bedrock error:
    // the client's structured picks stand on their own.
    console.warn('pairing narration unavailable:', err)
    return json(
      200,
      { narration: null, degraded: true } satisfies PairingNarration,
      origin,
    )
  }
}
