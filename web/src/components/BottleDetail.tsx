/**
 * Bottle detail (route `#/bottles/:id`) — serves both families. Lays out:
 *   - bottle meta (producer / region / type / ABV-or-roast / price / rating),
 *   - the D3 radar of its averaged flavor profile,
 *   - the "like this" recommendations panel (with cross-family picks),
 *   - the tasting-notes list (coffee wears aroma / flavor / aftertaste), and
 *   - the auth-gated log-a-note form (inline, with live radar preview).
 */
import { useEffect, useState } from 'react'
import type { BottleDetail as BottleDetailData } from '../lib/types'
import { EMPTY_FLAVOR, FLAVOR_AXES, familyOf, isCoffee } from '../lib/types'
import { getApi } from '../lib/api'
import { href, navigate } from '../lib/router'
import { useAuth } from './AuthContext'
import RadarChart from './RadarChart'
import RecommendationsPanel from './RecommendationsPanel'
import NoteForm, { NOTE_FIELD_LABELS } from './NoteForm'
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
  // Bumped after a note saves to force the bottle + recommendations to refetch.
  const [reloadKey, setReloadKey] = useState(0)

  // Liveness-guarded like the other screens: a slow response for a previous
  // bottle must not clobber the one currently shown.
  useEffect(() => {
    let live = true
    setData(null)
    setError(null)
    getApi()
      .getBottle(id)
      .then((d) => live && setData(d))
      .catch((e) => live && setError(e.message))
    return () => {
      live = false
    }
  }, [id, reloadKey])

  function startLogging() {
    if (token) setLogging(true)
    else onRequireAuth()
  }

  function onNoteSaved() {
    setLogging(false)
    setReloadKey((k) => k + 1)
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
  // Merge over EMPTY_FLAVOR: an API build that predates the 8-axis expansion
  // serves profiles missing the newer keys, which would NaN the radar.
  const profile = { ...EMPTY_FLAVOR, ...(bottle.flavorProfile ?? {}) }
  const hasProfile = bottle.flavorProfile != null
  const coffee = isCoffee(bottle.type)
  const noteLabels = NOTE_FIELD_LABELS[coffee ? 'coffee' : 'alcohol']

  return (
    <div className="flex flex-col gap-6">
      <BackLink family={familyOf(bottle.type)} />

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
            {coffee ? (
              <>
                {bottle.roast && <Tag>{bottle.roast} roast</Tag>}
                {bottle.process && <Tag>{bottle.process}</Tag>}
              </>
            ) : (
              <>
                {bottle.style && <Tag>{bottle.style}</Tag>}
                <Tag>{bottle.abv}% ABV</Tag>
              </>
            )}
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
              {coffee ? 'Edit coffee' : 'Edit bottle'}
            </button>
          )}
        </div>
      </div>

      {/* two columns on desktop: radar + notes | recommendations */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="flex flex-col gap-6 lg:col-span-2">
          <Panel>
            <SectionTitle hint={`${FLAVOR_AXES.length} shared axes`}>
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
                  bottleType={bottle.type}
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
                    <NoteLine label={noteLabels.nose} value={note.nose} />
                    <NoteLine label={noteLabels.palate} value={note.palate} />
                    <NoteLine label={noteLabels.finish} value={note.finish} />
                  </dl>
                </li>
              ))}
            </ul>
          </Panel>
        </div>

        <div className="lg:col-span-1">
          <RecommendationsPanel
            key={reloadKey}
            bottleId={bottle.id}
            bottleType={bottle.type}
          />
        </div>
      </div>
    </div>
  )
}

function NoteLine({ label, value }: { label: string; value: string }) {
  if (!value) return null
  return (
    <div className="flex gap-2">
      <dt className="text-muted w-20 shrink-0 font-mono text-xs uppercase">
        {label}
      </dt>
      <dd className="text-fg/90">{value}</dd>
    </div>
  )
}

function BackLink({ family = 'alcohol' as const }: { family?: 'alcohol' | 'coffee' }) {
  return (
    <button
      onClick={() => navigate(href.list(family))}
      className="text-muted hover:text-accent w-fit font-mono text-sm"
    >
      {family === 'coffee' ? '← the coffee bar' : '← the cabinet'}
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
