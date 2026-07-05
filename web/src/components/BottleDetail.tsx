/**
 * Bottle detail (route `#/bottles/:id`). Lays out:
 *   - bottle meta (producer / region / type / ABV / price / rating),
 *   - the D3 radar of its averaged flavor profile,
 *   - the "bottles like this" recommendations panel,
 *   - the tasting-notes list, and
 *   - the auth-gated log-a-note form (inline, with live radar preview).
 */
import { useCallback, useEffect, useState } from 'react'
import type { BottleDetail as BottleDetailData } from '../lib/types'
import { EMPTY_FLAVOR } from '../lib/types'
import { getApi } from '../lib/api'
import { href, navigate } from '../lib/router'
import { useAuth } from './AuthContext'
import RadarChart from './RadarChart'
import RecommendationsPanel from './RecommendationsPanel'
import NoteForm from './NoteForm'
import {
  Panel,
  RatingBadge,
  SectionTitle,
  Spinner,
  Tag,
  buttonClass,
  ghostButtonClass,
  ErrorNote,
} from './ui'

interface Props {
  id: string
  onRequireAuth: () => void
}

export default function BottleDetail({ id, onRequireAuth }: Props) {
  const { token } = useAuth()
  const [data, setData] = useState<BottleDetailData | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [logging, setLogging] = useState(false)
  // Bumped after a note saves to force the recommendations to refetch.
  const [recsKey, setRecsKey] = useState(0)

  const load = useCallback(() => {
    setData(null)
    setError(null)
    getApi()
      .getBottle(id)
      .then(setData)
      .catch((e) => setError(e.message))
  }, [id])

  useEffect(load, [load])

  function startLogging() {
    if (token) setLogging(true)
    else onRequireAuth()
  }

  function onNoteSaved() {
    setLogging(false)
    load()
    setRecsKey((k) => k + 1)
  }

  if (error) {
    return (
      <div className="flex flex-col gap-4">
        <BackLink />
        <ErrorNote>Couldn’t load this bottle: {error}</ErrorNote>
      </div>
    )
  }
  if (!data) return <Spinner label="Uncorking…" />

  const { bottle, notes } = data
  const profile = bottle.flavorProfile ?? EMPTY_FLAVOR
  const hasProfile = bottle.flavorProfile != null

  return (
    <div className="flex flex-col gap-6">
      <BackLink />

      {/* header: meta + rating + edit */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <h1 className="font-display text-fg text-2xl font-bold sm:text-3xl">
            {bottle.name}
          </h1>
          {bottle.grape && (
            <p className="font-display text-warm mt-1 text-lg font-semibold">
              {bottle.grape}
            </p>
          )}
          <p className="text-muted mt-1">{bottle.producer}</p>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <Tag tone="accent">{bottle.type}</Tag>
            <Tag>{bottle.region}</Tag>
            <Tag>{bottle.abv}% ABV</Tag>
            {bottle.price != null && <Tag tone="warm">${bottle.price}</Tag>}
          </div>
        </div>
        <div className="flex flex-col items-end gap-2">
          <RatingBadge value={bottle.avgRating} />
          <span className="text-muted font-mono text-xs">
            {bottle.noteCount} {bottle.noteCount === 1 ? 'note' : 'notes'}
          </span>
          {token && (
            <button
              className={`${ghostButtonClass} px-3 py-1 text-xs`}
              onClick={() => navigate(href.edit(bottle.id))}
            >
              Edit bottle
            </button>
          )}
        </div>
      </div>

      {/* two columns on desktop: radar + notes | recommendations */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="flex flex-col gap-6 lg:col-span-2">
          <Panel>
            <SectionTitle hint="sweet · smoky · fruity · oaky · spicy">
              Flavor profile
            </SectionTitle>
            {hasProfile ? (
              <RadarChart flavor={profile} showValues size={300} />
            ) : (
              <p className="text-muted text-sm">
                No flavor profile yet — log a tasting note to build the radar.
              </p>
            )}
          </Panel>

          <Panel>
            <div className="flex items-center justify-between">
              <SectionTitle>Tasting notes</SectionTitle>
              {!logging && (
                <button
                  className={`${buttonClass} px-3 py-1.5 text-sm`}
                  onClick={startLogging}
                >
                  + Log a note
                </button>
              )}
            </div>

            {logging && (
              <div className="border-line mb-5 rounded-xl border border-dashed p-4">
                <NoteForm
                  bottleId={bottle.id}
                  onSaved={onNoteSaved}
                  onCancel={() => setLogging(false)}
                />
              </div>
            )}

            {notes.length === 0 && !logging && (
              <p className="text-muted text-sm">
                No notes yet. Be the first to taste it.
              </p>
            )}

            <ul className="mt-4 flex flex-col gap-4">
              {notes.map((note) => (
                <li
                  key={note.id}
                  className="border-line bg-panel-2/40 rounded-lg border p-4"
                >
                  <div className="mb-2 flex items-center justify-between">
                    <span className="text-warm font-mono text-sm">
                      {note.rating}/10
                    </span>
                    <span className="text-muted font-mono text-xs">
                      {formatDate(note.createdAt)}
                    </span>
                  </div>
                  <dl className="flex flex-col gap-1.5 text-sm">
                    <NoteLine label="Nose" value={note.nose} />
                    <NoteLine label="Palate" value={note.palate} />
                    <NoteLine label="Finish" value={note.finish} />
                  </dl>
                </li>
              ))}
            </ul>
          </Panel>
        </div>

        <div className="lg:col-span-1">
          <RecommendationsPanel key={recsKey} bottleId={bottle.id} />
        </div>
      </div>
    </div>
  )
}

function NoteLine({ label, value }: { label: string; value: string }) {
  if (!value) return null
  return (
    <div className="flex gap-2">
      <dt className="text-muted w-14 shrink-0 font-mono text-xs uppercase">
        {label}
      </dt>
      <dd className="text-fg/90">{value}</dd>
    </div>
  )
}

function BackLink() {
  return (
    <button
      onClick={() => navigate(href.list())}
      className="text-muted hover:text-accent w-fit font-mono text-sm"
    >
      ← the cabinet
    </button>
  )
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  })
}
