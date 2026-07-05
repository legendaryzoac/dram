/**
 * Bottle list (route `#/`). Cards showing name / producer / region / type,
 * average rating, and note count, with client-side search + type/region
 * filters. The "Add bottle" action is auth-gated; signed-out visitors get a
 * prompt to sign in or enter demo mode.
 */
import { useEffect, useMemo, useState } from 'react'
import type { Bottle } from '../lib/types'
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
  onRequireAuth: () => void
}

export default function BottleList({ onRequireAuth }: Props) {
  const { token } = useAuth()
  const [bottles, setBottles] = useState<Bottle[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [type, setType] = useState('all')
  const [region, setRegion] = useState('all')

  useEffect(() => {
    let live = true
    getApi()
      .listBottles()
      .then((b) => live && setBottles(b))
      .catch((e) => live && setError(e.message))
    return () => {
      live = false
    }
  }, [])

  const types = useMemo(
    () => ['all', ...distinct(bottles, (b) => b.type)],
    [bottles],
  )
  const regions = useMemo(
    () => ['all', ...distinct(bottles, (b) => b.region)],
    [bottles],
  )

  const filtered = useMemo(() => {
    if (!bottles) return []
    const q = query.trim().toLowerCase()
    return bottles.filter((b) => {
      if (type !== 'all' && b.type !== type) return false
      if (region !== 'all' && b.region !== region) return false
      if (!q) return true
      return (
        b.name.toLowerCase().includes(q) ||
        b.producer.toLowerCase().includes(q) ||
        b.region.toLowerCase().includes(q)
      )
    })
  }, [bottles, query, type, region])

  function addBottle() {
    if (token) navigate(href.add())
    else onRequireAuth()
  }

  return (
    <div className="flex flex-col gap-5">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-fg text-2xl font-bold sm:text-3xl">
            The cabinet
          </h1>
          <p className="text-muted mt-1 text-sm">
            {bottles ? `${bottles.length} bottles logged` : 'Loading bottles…'} ·
            tap one for notes, radar &amp; recommendations
          </p>
        </div>
        <button className={buttonClass} onClick={addBottle}>
          + Add bottle
        </button>
      </header>

      <div className="flex flex-col gap-3 sm:flex-row">
        <input
          className={`${inputClass} sm:max-w-xs`}
          placeholder="Search name, producer, region…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <select
          className={`${inputClass} sm:w-40`}
          value={type}
          onChange={(e) => setType(e.target.value)}
          aria-label="Filter by type"
        >
          {types.map((t) => (
            <option key={t} value={t}>
              {t === 'all' ? 'All types' : t}
            </option>
          ))}
        </select>
        <select
          className={`${inputClass} sm:w-44`}
          value={region}
          onChange={(e) => setRegion(e.target.value)}
          aria-label="Filter by region"
        >
          {regions.map((r) => (
            <option key={r} value={r}>
              {r === 'all' ? 'All regions' : r}
            </option>
          ))}
        </select>
      </div>

      {error && <ErrorNote>Couldn’t load bottles: {error}</ErrorNote>}
      {!bottles && !error && <Spinner label="Pouring the list…" />}

      {bottles && filtered.length === 0 && (
        <Panel>
          <p className="text-muted text-sm">No bottles match those filters.</p>
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
              <Tag>{b.abv}% ABV</Tag>
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
  return [...new Set(bottles.map(pick))].sort((a, b) => a.localeCompare(b))
}
