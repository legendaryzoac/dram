/**
 * Bottle list — one component, two tabs: the cabinet (route `#/`, alcohol) and
 * the coffee bar (route `#/coffee`). Cards showing name / producer / region /
 * type, average rating, and note count, with client-side search + type/roast
 * and region filters. The "Add" action is auth-gated; signed-out visitors get
 * a prompt to sign in or enter demo mode.
 */
import { useEffect, useMemo, useState } from 'react'
import type { BeverageFamily, Bottle } from '../lib/types'
import { familyOf, isCoffee } from '../lib/types'
import { getApi } from '../lib/api'
import { href, navigate } from '../lib/router'
import { useAuth } from './AuthContext'
import {
  Panel,
  RatingBadge,
  Spinner,
  Tag,
  buttonClass,
  inputClass,
  ErrorNote,
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
    unit: (n: number) => string
    add: string
    loading: string
    spinner: string
    empty: string
  }
> = {
  alcohol: {
    title: 'The cabinet',
    unit: (n) => `${n} ${n === 1 ? 'bottle' : 'bottles'} logged`,
    add: '+ Add bottle',
    loading: 'Loading bottles…',
    spinner: 'Pouring the list…',
    empty: 'No bottles match those filters.',
  },
  coffee: {
    title: 'The coffee bar',
    unit: (n) => `${n} ${n === 1 ? 'coffee' : 'coffees'} logged`,
    add: '+ Add coffee',
    loading: 'Loading coffees…',
    spinner: 'Grinding the list…',
    empty: 'No coffees match those filters.',
  },
}

export default function BottleList({ family, onRequireAuth }: Props) {
  const { token } = useAuth()
  const [all, setAll] = useState<Bottle[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [type, setType] = useState('all')
  const [region, setRegion] = useState('all')

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

  const filtered = useMemo(() => {
    if (!bottles) return []
    const q = query.trim().toLowerCase()
    return bottles.filter((b) => {
      const facet = coffeeTab ? (b.roast ?? '') : b.type
      if (type !== 'all' && facet !== type) return false
      if (region !== 'all' && b.region !== region) return false
      if (!q) return true
      return (
        b.name.toLowerCase().includes(q) ||
        b.producer.toLowerCase().includes(q) ||
        b.region.toLowerCase().includes(q)
      )
    })
  }, [bottles, query, type, region, coffeeTab])

  function addBottle() {
    if (token) navigate(href.add(family))
    else onRequireAuth()
  }

  const copy = COPY[family]

  return (
    <div className="flex flex-col gap-5">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-fg text-2xl font-bold sm:text-3xl">
            {copy.title}
          </h1>
          <p className="text-muted mt-1 text-sm">
            {bottles ? copy.unit(bottles.length) : copy.loading} · tap one for
            notes, radar &amp; recommendations
          </p>
        </div>
        <button className={buttonClass} onClick={addBottle}>
          {copy.add}
        </button>
      </header>

      <div className="flex flex-col gap-3 sm:flex-row">
        <input
          className={`${inputClass} sm:max-w-xs`}
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
      </div>

      {error && <ErrorNote>Couldn’t load the list: {error}</ErrorNote>}
      {!bottles && !error && <Spinner label={copy.spinner} />}

      {bottles && filtered.length === 0 && (
        <Panel>
          <p className="text-muted text-sm">
            {bottles.length === 0
              ? coffeeTab
                ? 'No coffees logged yet — add your first bag.'
                : 'No bottles logged yet — add your first one.'
              : copy.empty}
          </p>
        </Panel>
      )}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {filtered.map((b) => (
          <button
            key={b.id}
            onClick={() => navigate(href.detail(b.id))}
            className="border-line bg-panel/60 hover:border-accent/60 hover:bg-panel group flex flex-col gap-3 rounded-xl border p-4 text-left transition-colors"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <h2 className="font-display text-fg group-hover:text-accent truncate text-base font-semibold transition-colors">
                  {b.name}
                </h2>
                <p className="text-muted truncate text-sm">{b.producer}</p>
              </div>
              <RatingBadge value={b.avgRating} />
            </div>
            {b.grape && (
              <span className="font-display text-warm -mt-1 text-sm font-semibold">
                {b.grape}
              </span>
            )}
            <div className="mt-auto flex flex-wrap items-center gap-2">
              <Tag tone="accent">{b.type}</Tag>
              <Tag>{b.region}</Tag>
              {isCoffee(b.type) ? (
                b.roast && <Tag>{b.roast} roast</Tag>
              ) : (
                <Tag>{b.abv}% ABV</Tag>
              )}
              {b.style && <Tag>{b.style}</Tag>}
              <span className="text-muted ml-auto font-mono text-xs">
                {b.noteCount} {b.noteCount === 1 ? 'note' : 'notes'}
              </span>
            </div>
          </button>
        ))}
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
