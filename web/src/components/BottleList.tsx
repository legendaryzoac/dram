/**
 * Bottle list — one component, two tabs: the cabinet (route `#/`, alcohol) and
 * the coffee bar (route `#/coffee`). Cards showing name / producer, average
 * rating, one meta line (type · region · strength), and note count, with
 * client-side search plus type/roast, region, status, and notes (with /
 * without) filters. The list opens on what's on the shelf; finished bottles
 * and ones tasted elsewhere are a status filter away. The "Add" action is
 * auth-gated; signed-out visitors get a prompt to sign in or enter demo mode.
 */
import { useEffect, useMemo, useState } from 'react'
import type { BeverageFamily, Bottle, BottleStatus } from '../lib/types'
import { BOTTLE_STATUSES, STATUS_LABELS, familyOf, isCoffee } from '../lib/types'
import { getApi } from '../lib/api'
import { capitalize } from '../lib/recommend'
import { href, navigate } from '../lib/router'
import { useAuth } from './AuthContext'
import {
  Meta,
  Notice,
  Panel,
  RatingBadge,
  Spinner,
  buttonClass,
  inputClass,
} from './ui'

interface Props {
  family: BeverageFamily
  onRequireAuth: () => void
}

/** Family-specific copy so the coffee tab doesn't read like a liquor shelf. */
const COPY: Record<
  BeverageFamily,
  {
    title: string
    noun: (n: number) => string
    add: string
    loading: string
    spinner: string
    empty: string
    /** Nothing on the shelf, but there is something under another status. */
    shelfEmpty: string
    /** The "no filter" option of the notes select. */
    all: string
  }
> = {
  alcohol: {
    title: 'The cabinet',
    noun: (n) => (n === 1 ? 'bottle' : 'bottles'),
    add: '+ Add bottle',
    loading: 'Loading bottles…',
    spinner: 'Pouring the list…',
    empty: 'No bottles match those filters.',
    shelfEmpty:
      'Nothing on the shelf right now. Finished bottles and ones tasted elsewhere are under the status filter.',
    all: 'All bottles',
  },
  coffee: {
    title: 'The coffee bar',
    noun: (n) => (n === 1 ? 'coffee' : 'coffees'),
    add: '+ Add coffee',
    loading: 'Loading coffees…',
    spinner: 'Grinding the list…',
    empty: 'No coffees match those filters.',
    shelfEmpty:
      'Nothing on the shelf right now. Finished bags and coffees tasted elsewhere are under the status filter.',
    all: 'All coffees',
  },
}

/** Whether a bottle has tasting notes yet — the filter that separates what
 *  you've written up from what's still waiting on the shelf. */
type NotesFilter = 'all' | 'with' | 'without'

/** Which shelf to show. The cabinet by default: what's finished, and what
 *  was only tasted elsewhere, is logged but not on hand. */
type StatusFilter = BottleStatus | 'all'

export default function BottleList({ family, onRequireAuth }: Props) {
  const { token } = useAuth()
  const [all, setAll] = useState<Bottle[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [type, setType] = useState('all')
  const [region, setRegion] = useState('all')
  const [status, setStatus] = useState<StatusFilter>('cabinet')
  const [notes, setNotes] = useState<NotesFilter>('all')

  useEffect(() => {
    let live = true
    getApi()
      .listBottles()
      .then((b) => live && setAll(b))
      .catch((e) => live && setError(e.message))
    return () => {
      live = false
    }
  }, [])

  const bottles = useMemo(
    () => (all ? all.filter((b) => familyOf(b.type) === family) : null),
    [all, family],
  )

  // Coffee is a single type, so its first filter slices by roast instead.
  const coffeeTab = family === 'coffee'
  const types = useMemo(
    () =>
      ['all', ...distinct(bottles, (b) => (coffeeTab ? (b.roast ?? '') : b.type))],
    [bottles, coffeeTab],
  )
  const regions = useMemo(
    () => ['all', ...distinct(bottles, (b) => b.region)],
    [bottles],
  )

  // The status scope first: the header counts against it, and the other
  // filters narrow within it.
  const scoped = useMemo(
    () => (bottles ?? []).filter((b) => status === 'all' || b.status === status),
    [bottles, status],
  )
  const offShelf = useMemo(() => {
    const count = { finished: 0, tasted: 0 }
    for (const b of bottles ?? []) if (b.status !== 'cabinet') count[b.status] += 1
    return count
  }, [bottles])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return scoped.filter((b) => {
      const facet = coffeeTab ? (b.roast ?? '') : b.type
      if (type !== 'all' && facet !== type) return false
      if (region !== 'all' && b.region !== region) return false
      if (notes === 'with' && b.noteCount === 0) return false
      if (notes === 'without' && b.noteCount > 0) return false
      if (!q) return true
      return (
        b.name.toLowerCase().includes(q) ||
        b.producer.toLowerCase().includes(q) ||
        b.region.toLowerCase().includes(q)
      )
    })
  }, [scoped, query, type, region, notes, coffeeTab])

  function addBottle() {
    if (token) navigate(href.add(family))
    else onRequireAuth()
  }

  const copy = COPY[family]

  // "72 bottles on the shelf · 8 finished · 11 tasted elsewhere", or how far
  // the other filters narrowed it, or the standing hint.
  const countLine = `${scoped.length} ${copy.noun(scoped.length)} ${
    status === 'all' ? 'logged' : STATUS_LABELS[status]
  }`
  const offShelfSegments = [
    offShelf.finished > 0 && `· ${offShelf.finished} finished`,
    offShelf.tasted > 0 && `· ${offShelf.tasted} tasted elsewhere`,
  ].filter((s): s is string => Boolean(s))
  const tail =
    filtered.length !== scoped.length
      ? [`· showing ${filtered.length}`]
      : status === 'cabinet' && offShelfSegments.length > 0
        ? offShelfSegments
        : ['· tap one for notes, radar & recommendations']

  return (
    <div className="flex flex-col gap-5">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-fg text-2xl font-bold sm:text-3xl">
            {copy.title}
          </h1>
          {/* Segments never break inside themselves: a narrow screen moves a
              whole "· 1 tasted elsewhere" to the next line, never half of it. */}
          <p className="text-muted mt-1 flex flex-wrap gap-x-1.5 text-sm">
            {bottles
              ? [countLine, ...tail].map((segment) => (
                  <span key={segment} className="whitespace-nowrap">
                    {segment}
                  </span>
                ))
              : copy.loading}
          </p>
        </div>
        <button className={buttonClass} onClick={addBottle}>
          {copy.add}
        </button>
      </header>

      {/* Phones: search, then type | region, then status | notes — three
          rows. From 640px: one row, wrapping while five don't fit. */}
      <div className="grid grid-cols-2 gap-3 sm:flex sm:flex-row sm:flex-wrap">
        <input
          className={`${inputClass} col-span-2 sm:max-w-xs`}
          placeholder={
            coffeeTab
              ? 'Search name, roaster, origin…'
              : 'Search name, producer, region…'
          }
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <select
          className={`${inputClass} sm:w-40`}
          value={type}
          onChange={(e) => setType(e.target.value)}
          aria-label={coffeeTab ? 'Filter by roast' : 'Filter by type'}
        >
          {types.map((t) => (
            <option key={t} value={t}>
              {t === 'all' ? (coffeeTab ? 'All roasts' : 'All types') : t}
            </option>
          ))}
        </select>
        <select
          className={`${inputClass} sm:w-44`}
          value={region}
          onChange={(e) => setRegion(e.target.value)}
          aria-label={coffeeTab ? 'Filter by origin' : 'Filter by region'}
        >
          {regions.map((r) => (
            <option key={r} value={r}>
              {r === 'all' ? (coffeeTab ? 'All origins' : 'All regions') : r}
            </option>
          ))}
        </select>
        <select
          className={`${inputClass} sm:w-44`}
          value={status}
          onChange={(e) => setStatus(e.target.value as StatusFilter)}
          aria-label="Filter by status"
        >
          {BOTTLE_STATUSES.map((s) => (
            <option key={s} value={s}>
              {capitalize(STATUS_LABELS[s])}
            </option>
          ))}
          <option value="all">Any status</option>
        </select>
        <select
          className={`${inputClass} sm:w-40`}
          value={notes}
          onChange={(e) => setNotes(e.target.value as NotesFilter)}
          aria-label="Filter by notes"
        >
          <option value="all">{copy.all}</option>
          <option value="with">With notes</option>
          <option value="without">No notes yet</option>
        </select>
      </div>

      {error && <Notice>Couldn’t load the list: {error}</Notice>}
      {!bottles && !error && <Spinner label={copy.spinner} />}

      {bottles && filtered.length === 0 && (
        <Panel>
          <p className="text-muted text-sm">
            {bottles.length === 0
              ? coffeeTab
                ? 'No coffees logged yet — add your first bag.'
                : 'No bottles logged yet — add your first one.'
              : scoped.length === 0 && status === 'cabinet'
                ? copy.shelfEmpty
                : copy.empty}
          </p>
        </Panel>
      )}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {filtered.map((b) => {
          const rated = b.noteCount > 0
          return (
            <button
              key={b.id}
              onClick={() => navigate(href.detail(b.id))}
              className="border-line bg-panel/60 hover:border-accent/60 hover:bg-panel group relative flex flex-col gap-3 rounded-xl border p-4 text-left transition-colors"
            >
              {/* Name block left; rating and note count up top on the right,
                  beside the name. An unrated card's right side has only
                  "no notes yet" to say, so that floats centred on the card
                  and the name block leaves it room. Either way the meta line
                  below gets the card's full width. */}
              <div className="flex items-start justify-between gap-3">
                <div className={`min-w-0 ${rated ? '' : 'pr-24'}`}>
                  <h2 className="font-display text-fg group-hover:text-accent truncate text-base font-semibold transition-colors">
                    {b.name}
                  </h2>
                  <p className="text-muted truncate text-sm">{b.producer}</p>
                  {b.grape && (
                    <p className="font-display text-warm mt-1 truncate text-sm font-semibold">
                      {b.grape}
                    </p>
                  )}
                </div>
                {rated && (
                  <div className="flex shrink-0 flex-col items-end">
                    <RatingBadge value={b.avgRating} />
                    <span className="text-muted font-mono text-xs">
                      {b.noteCount} {b.noteCount === 1 ? 'note' : 'notes'}
                    </span>
                  </div>
                )}
              </div>
              {/* One line, never two: type (the lead) · region · strength,
                  plus a warm "finished" / "tasted elsewhere" only when the
                  list mixes statuses. The % needs no "ABV" here; style,
                  process and price belong to the detail page. */}
              <Meta
                className="mt-auto"
                items={[
                  { text: b.type, tone: 'lead' },
                  status === 'all' &&
                    b.status !== 'cabinet' && { text: STATUS_LABELS[b.status], tone: 'warm' },
                  b.region,
                  isCoffee(b.type) ? b.roast && `${b.roast} roast` : `${b.abv}%`,
                ]}
              />
              {!rated && (
                <span className="absolute top-1/2 right-4 flex -translate-y-1/2">
                  <RatingBadge value={null} />
                </span>
              )}
            </button>
          )
        })}
      </div>
    </div>
  )
}

function distinct(
  bottles: Bottle[] | null,
  pick: (b: Bottle) => string,
): string[] {
  if (!bottles) return []
  return [...new Set(bottles.map(pick).filter((v) => v !== ''))].sort((a, b) =>
    a.localeCompare(b),
  )
}
