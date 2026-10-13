/**
 * Account hub (route `#/account`, reached from the footer's "account" link).
 * Signed out it's a sign-in prompt; signed in it shows:
 *   - who's signed in + sign out,
 *   - corpus stats (what's on the shelf, what's finished or was only tasted
 *     elsewhere, notes, average rating),
 *   - the drinker's aggregate palate on the radar,
 *   - "tonight's picks" — what's on the shelf, ranked against that palate,
 *   - the tasting-note history, newest first.
 * Reads are public; the gate here is presentational (it's *your* page).
 */
import { useEffect, useState } from 'react'
import type { BottleDetail } from '../lib/types'
import { familyOf, isCoffee, onShelf } from '../lib/types'
import { getApi } from '../lib/api'
import { href, navigate } from '../lib/router'
import { useAuth } from './AuthContext'
import RadarChart from './RadarChart'
import { NOTE_FIELD_LABELS } from '../lib/noteFields'
import {
  averageRating,
  collectNotes,
  gearStats,
  loadCorpus,
  tasteProfile,
  topAxes,
  type HubNote,
} from '../lib/hub'
import { rankByTasteProfile, type ScoredBottle } from '../lib/recommend'
import {
  Meta,
  Notice,
  Panel,
  Row,
  SectionTitle,
  Spinner,
  buttonClass,
  ghostButtonClass,
} from './ui'

const RECENT_NOTES = 8
const PICKS_PER_FAMILY = 3

interface Props {
  onRequireAuth: () => void
}

export default function AccountPage({ onRequireAuth }: Props) {
  const { token, email, mode, signOut } = useAuth()
  const [details, setDetails] = useState<BottleDetail[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  // Load the full corpus — two public reads, see loadCorpus. Skipped while
  // signed out; re-runs on sign-in.
  useEffect(() => {
    if (!token) return
    let live = true
    loadCorpus(getApi())
      .then((d) => {
        if (live) {
          setDetails(d)
          setError(null)
        }
      })
      .catch((e) => live && setError(e.message))
    return () => {
      live = false
    }
  }, [token])

  if (!token) {
    return (
      <div className="mx-auto max-w-md">
        <Panel>
          <h1 className="font-display text-fg mb-2 text-xl font-semibold">
            Your hub
          </h1>
          <p className="text-muted mb-4 text-sm">
            Sign in to see your tasting notes, your palate on the radar, and
            what to pour tonight.
          </p>
          <button className={buttonClass} onClick={onRequireAuth}>
            Sign in
          </button>
        </Panel>
      </div>
    )
  }

  if (error) {
    return (
      <div className="flex flex-col gap-4">
        <Notice>Couldn’t load your hub: {error}</Notice>
      </div>
    )
  }
  if (!details) return <Spinner label="Opening the ledger…" />

  const bottles = details.map((d) => d.bottle)
  const notes = collectNotes(details)
  const palate = tasteProfile(notes)
  const avg = averageRating(notes)

  // Tonight's picks pour from the shelf; the palate and the notes draw on
  // everything, finished bottles and bar pours included.
  const shelf = bottles.filter(onShelf)
  const cabinet = shelf.filter((b) => familyOf(b.type) === 'alcohol')
  const coffees = shelf.filter((b) => familyOf(b.type) === 'coffee')
  const finished = bottles.filter((b) => b.status === 'finished').length
  const tasted = bottles.filter((b) => b.status === 'tasted').length
  const cabinetPicks = palate
    ? rankByTasteProfile(palate, cabinet).slice(0, PICKS_PER_FAMILY)
    : []
  const coffeePicks = palate
    ? rankByTasteProfile(palate, coffees).slice(0, PICKS_PER_FAMILY)
    : []
  const gear = gearStats(notes)

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="font-display text-fg text-2xl font-bold sm:text-3xl">
            Your hub
          </h1>
          <p className="text-muted mt-1 font-mono text-xs">
            {mode === 'demo' ? 'demo mode' : email}
          </p>
        </div>
        <button
          className={`${ghostButtonClass} px-3 py-1.5 text-sm`}
          onClick={signOut}
        >
          Sign out
        </button>
      </header>

      {/* Three groups of facts. On a wide screen they share a line; on a
          phone a group moves down whole — a line never breaks mid-group. */}
      <div className="flex flex-wrap gap-x-5 gap-y-1">
        <Meta
          items={[
            `${cabinet.length} ${cabinet.length === 1 ? 'bottle' : 'bottles'} on the shelf`,
            `${coffees.length} ${coffees.length === 1 ? 'coffee' : 'coffees'}`,
          ]}
        />
        <Meta
          items={[
            finished > 0 && `${finished} finished`,
            tasted > 0 && `${tasted} tasted elsewhere`,
          ]}
        />
        <Meta
          items={[
            `${notes.length} ${notes.length === 1 ? 'note' : 'notes'} written`,
            avg != null && { text: `${avg.toFixed(1)} / 10 average`, tone: 'warm' },
          ]}
        />
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="flex flex-col gap-6 lg:col-span-2">
          <Panel>
            <SectionTitle hint="mean of every note you’ve logged">
              Your palate
            </SectionTitle>
            {palate ? (
              <>
                <RadarChart flavor={palate} showValues size={300} />
                <p className="text-muted mt-2 text-center font-mono text-xs">
                  leans {topAxes(palate).join(' · ') || '—'}
                </p>
              </>
            ) : (
              <p className="text-muted text-sm">
                No notes yet — log a tasting to start building your palate.
              </p>
            )}
          </Panel>

          <Panel>
            <SectionTitle hint={`latest ${Math.min(RECENT_NOTES, notes.length)} of ${notes.length}`}>
              Your tasting notes
            </SectionTitle>
            {notes.length === 0 ? (
              <p className="text-muted text-sm">
                Nothing logged yet. Open a bottle and write the first one.
              </p>
            ) : (
              <ul className="flex flex-col gap-3">
                {notes.slice(0, RECENT_NOTES).map((note) => (
                  <HubNoteRow key={note.id} note={note} />
                ))}
              </ul>
            )}
          </Panel>
        </div>

        <div className="flex flex-col gap-6 lg:col-span-1">
          <Panel>
            <SectionTitle hint="ranked against your palate">
              Tonight’s picks
            </SectionTitle>
            {!palate ? (
              <p className="text-muted text-sm">
                Log a few notes and dram will rank your shelf against your
                taste.
              </p>
            ) : (
              <div className="flex flex-col gap-4">
                <PickList label="From the cabinet" picks={cabinetPicks} />
                <PickList label="From the coffee bar" picks={coffeePicks} />
              </div>
            )}
          </Panel>

          <Panel>
            <SectionTitle hint="from your brew notes">
              Your coffee gear
            </SectionTitle>
            {gear.grinders.length === 0 && gear.methods.length === 0 ? (
              <p className="text-muted text-sm">
                Add brew details (grinder, method, grind size…) when you log a
                coffee note and your setup shows up here.
              </p>
            ) : (
              <div className="flex flex-col gap-4">
                <GearList label="Grinders" items={gear.grinders} />
                <GearList label="Methods & machines" items={gear.methods} />
              </div>
            )}
          </Panel>
        </div>
      </div>
    </div>
  )
}

function GearList({
  label,
  items,
}: {
  label: string
  items: Array<[string, number]>
}) {
  if (items.length === 0) return null
  return (
    <div className="flex flex-col gap-2">
      <p className="text-muted font-mono text-[0.7rem] tracking-wide uppercase">
        {label}
      </p>
      <ul className="flex flex-col gap-1.5">
        {items.map(([name, count]) => (
          <li
            key={name}
            className="border-line bg-panel-2/50 flex items-center justify-between gap-3 rounded-lg border px-3 py-2"
          >
            <span className="text-fg/90 min-w-0 truncate text-sm">{name}</span>
            <span className="text-muted shrink-0 font-mono text-xs">
              ×{count}
            </span>
          </li>
        ))}
      </ul>
    </div>
  )
}

function HubNoteRow({ note }: { note: HubNote }) {
  const labels = NOTE_FIELD_LABELS[isCoffee(note.bottleType) ? 'coffee' : 'alcohol']
  // Lead with the palate/flavor line — it's the most telling; fall back to
  // whichever prose field has content.
  const text = note.palate || note.nose || note.finish
  const textLabel = note.palate ? labels.palate : note.nose ? labels.nose : labels.finish
  return (
    <li className="border-line bg-panel-2/40 rounded-lg border p-3">
      <div className="flex items-center justify-between gap-3">
        <button
          onClick={() => navigate(href.detail(note.bottleId))}
          className="font-display text-fg hover:text-accent min-w-0 truncate text-left font-medium transition-colors"
        >
          {note.bottleName}
        </button>
        <span className="text-warm shrink-0 font-mono text-sm">
          {note.rating}/10
        </span>
      </div>
      {text && (
        <p className="text-muted mt-1.5 text-sm">
          <span className="font-mono text-[0.65rem] uppercase opacity-70">
            {textLabel}{' '}
          </span>
          {text}
        </p>
      )}
      <p className="text-muted mt-1.5 font-mono text-xs opacity-60">
        {formatDate(note.createdAt)}
      </p>
    </li>
  )
}

function PickList({ label, picks }: { label: string; picks: ScoredBottle[] }) {
  return (
    <div className="flex flex-col gap-2">
      <p className="text-muted font-mono text-[0.7rem] tracking-wide uppercase">
        {label}
      </p>
      {picks.length === 0 ? (
        <p className="text-muted text-sm">Nothing with notes yet.</p>
      ) : (
        <ol className="flex flex-col gap-2">
          {picks.map((p, i) => (
            <li key={p.bottle.id}>
              <Row
                rank={i + 1}
                name={p.bottle.name}
                detail={p.bottle.type}
                score={p.score}
                reason={p.reason}
                onOpen={() => navigate(href.detail(p.bottle.id))}
              />
            </li>
          ))}
        </ol>
      )}
    </div>
  )
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  })
}
