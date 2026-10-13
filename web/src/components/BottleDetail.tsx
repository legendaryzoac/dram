/**
 * Bottle detail (route `#/bottles/:id`) — serves both families. Lays out:
 *   - bottle meta (producer, then one line: type · region · style-or-roast ·
 *     ABV · price, and "finished" / "tasted elsewhere" when it isn't on the
 *     shelf) with a single-row rating + note-count + edit cluster,
 *   - the D3 radar of its averaged flavor profile,
 *   - the "like this" recommendations panel (with cross-family picks),
 *   - the tasting-notes list (coffee wears aroma / flavor / aftertaste, shows
 *     brew metadata, and each of your notes can be edited in place), and
 *   - the auth-gated log-a-note form (inline, with live radar preview).
 */
import { useEffect, useMemo, useState } from 'react'
import type { BottleDetail as BottleDetailData, TastingNote } from '../lib/types'
import {
  EMPTY_FLAVOR,
  FLAVOR_AXES,
  STATUS_LABELS,
  familyOf,
  isCoffee,
} from '../lib/types'
import { getApi } from '../lib/api'
import { href, navigate } from '../lib/router'
import { useAuth } from './AuthContext'
import { NOTE_FIELD_LABELS } from '../lib/noteFields'
import RadarChart from './RadarChart'
import RecommendationsPanel from './RecommendationsPanel'
import NoteForm, { type BrewSuggestions } from './NoteForm'
import {
  Meta,
  Notice,
  Panel,
  RatingBadge,
  SectionTitle,
  Spinner,
  buttonClass,
  ghostButtonClass,
} from './ui'

/** Select-or-type starters for the brew method field, merged with whatever
 *  gear this bottle's notes already mention. */
const METHOD_PRESETS = [
  'V60 pour over',
  'Espresso',
  'AeroPress',
  'French press',
  'Chemex',
  'Moka pot',
  'Cold brew',
]

interface Props {
  id: string
  onRequireAuth: () => void
}

export default function BottleDetail({ id, onRequireAuth }: Props) {
  const { token } = useAuth()
  const [data, setData] = useState<BottleDetailData | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [logging, setLogging] = useState(false)
  const [editingNoteId, setEditingNoteId] = useState<string | null>(null)
  // Bumped after a note saves to force the bottle + recommendations to refetch.
  const [reloadKey, setReloadKey] = useState(0)

  // Liveness-guarded like the other screens: a slow response for a previous
  // fetch must not clobber the one currently shown. No reset-in-effect: the
  // component is keyed by id, and a reloadKey refetch keeps the current data
  // on screen until the fresh copy lands.
  useEffect(() => {
    let live = true
    getApi()
      .getBottle(id)
      .then((d) => {
        if (live) {
          setData(d)
          setError(null)
        }
      })
      .catch((e) => live && setError(e.message))
    return () => {
      live = false
    }
  }, [id, reloadKey])

  const brewSuggestions: BrewSuggestions = useMemo(() => {
    const notes = data?.notes ?? []
    const grinders = distinct(notes.map((n) => n.brew?.grinder))
    const methods = distinct([
      ...notes.map((n) => n.brew?.method),
      ...METHOD_PRESETS,
    ])
    return { grinders, methods }
  }, [data])

  function startLogging() {
    if (token) {
      setEditingNoteId(null)
      setLogging(true)
    } else {
      onRequireAuth()
    }
  }

  function startEditing(noteId: string) {
    if (token) {
      setLogging(false)
      setEditingNoteId(noteId)
    } else {
      onRequireAuth()
    }
  }

  function onNoteSaved() {
    setLogging(false)
    setEditingNoteId(null)
    setReloadKey((k) => k + 1)
  }

  if (error) {
    return (
      <div className="flex flex-col gap-4">
        <BackLink />
        <Notice>Couldn’t load this bottle: {error}</Notice>
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

      {/* header: meta left; one row of rating · count · edit right */}
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
          {/* Everything about the bottle on one quiet line; the type leads
              in accent, the rating beside it is the only oxblood. */}
          <Meta
            className="mt-3"
            items={[
              { text: bottle.type, tone: 'lead' },
              bottle.region,
              ...(coffee
                ? [bottle.roast && `${bottle.roast} roast`, bottle.process]
                : [bottle.style, `${bottle.abv}% ABV`]),
              bottle.price != null && `$${bottle.price}`,
              bottle.status !== 'cabinet' && {
                text: STATUS_LABELS[bottle.status],
                tone: 'warm',
              },
            ]}
          />
        </div>
        <div className="flex flex-wrap items-center gap-3">
          {/* RatingBadge already reads "no notes yet" when unrated, so the
              zero count would say the same thing twice. */}
          <RatingBadge value={bottle.avgRating} />
          {bottle.noteCount > 0 && (
            <span className="text-muted font-mono text-xs">
              {bottle.noteCount} {bottle.noteCount === 1 ? 'note' : 'notes'}
            </span>
          )}
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
                  brewSuggestions={brewSuggestions}
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
                  className="border-line bg-panel-2/50 rounded-lg border p-4"
                >
                  {editingNoteId === note.id ? (
                    <NoteForm
                      bottleId={bottle.id}
                      bottleType={bottle.type}
                      editNote={note}
                      brewSuggestions={brewSuggestions}
                      onSaved={onNoteSaved}
                      onCancel={() => setEditingNoteId(null)}
                    />
                  ) : (
                    <NoteView
                      note={note}
                      coffee={coffee}
                      labels={noteLabels}
                      canEdit={Boolean(token)}
                      onEdit={() => startEditing(note.id)}
                    />
                  )}
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

function NoteView({
  note,
  coffee,
  labels,
  canEdit,
  onEdit,
}: {
  note: TastingNote
  coffee: boolean
  labels: (typeof NOTE_FIELD_LABELS)['alcohol' | 'coffee']
  canEdit: boolean
  onEdit: () => void
}) {
  const brewLine = coffee && note.brew ? formatBrew(note.brew) : null
  return (
    <>
      <div className="mb-2 flex items-center justify-between gap-3">
        <span className="flex items-baseline gap-2">
          <span className="text-warm font-mono text-sm">{note.rating}/10</span>
          {note.updatedAt && (
            <span className="text-muted font-mono text-[0.65rem] opacity-70">
              edited
            </span>
          )}
        </span>
        <span className="flex items-center gap-3">
          <span className="text-muted font-mono text-xs">
            {formatDate(note.createdAt)}
          </span>
          {canEdit && (
            <button
              onClick={onEdit}
              className="text-muted hover:text-accent font-mono text-xs transition-colors"
            >
              edit
            </button>
          )}
        </span>
      </div>
      <dl className="flex flex-col gap-1.5 text-sm">
        <NoteLine label={labels.nose} value={note.nose} />
        <NoteLine label={labels.palate} value={note.palate} />
        <NoteLine label={labels.finish} value={note.finish} />
      </dl>
      {brewLine && (
        <p className="text-accent-dim mt-2 font-mono text-xs">{brewLine}</p>
      )}
    </>
  )
}

/** "Fellow Ode Gen 2 · V60 pour over · grind 4.33 · 1:15 · 3:02" */
function formatBrew(brew: NonNullable<TastingNote['brew']>): string | null {
  const parts = [
    brew.grinder,
    brew.method,
    brew.grindSize ? `grind ${brew.grindSize}` : undefined,
    brew.ratio,
    brew.time,
  ].filter(Boolean)
  return parts.length > 0 ? parts.join(' · ') : null
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

function distinct(values: Array<string | undefined>): string[] {
  return [...new Set(values.filter((v): v is string => Boolean(v)))]
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  })
}
