/**
 * Pairing (route `#/pair`) — its own section beside the cabinet and the coffee
 * bar. "I'm having the steak, what should I order?" and "I'm lighting a cigar,
 * what should I pour?" Two layers:
 *
 *   1. Structured, instant, offline (lib/pairing): the dish or cigar resolves
 *      to a target flavor profile + type affinities; the cabinet is ranked
 *      against it, and menu-ordering tips are anchored to bottles you love.
 *   2. Narrated (POST /pairings → Haiku) over the real cabinet. Requested only
 *      when you submit a pairing — never on load, never while typing, and not
 *      again when the "read as" category is adjusted afterwards. Needs a
 *      signed-in session (it is a model call with free-text input) and fails
 *      soft to layer 1.
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import type { Bottle, CigarStrength, PairingRequest } from '../lib/types'
import { familyOf } from '../lib/types'
import { getApi } from '../lib/api'
import {
  CIGAR_BRANDS,
  FOOD_OCCASIONS,
  UNKNOWN_OCCASION,
  WRAPPERS,
  cigarLabel,
  cigarOccasion,
  foodOccasion,
  lookupCigarBrand,
  matchFood,
  orderTips,
  rankPairings,
  resolveCigar,
  type Occasion,
  type PairingPick,
  type ResolvedCigar,
  type Wrapper,
} from '../lib/pairing'
import { href, navigate } from '../lib/router'
import { useAuth } from './AuthContext'
import Narration, { type NarrationLink } from './Narration'
import {
  Panel,
  SectionTitle,
  Segmented,
  Spinner,
  buttonClass,
  fieldClass,
  ghostButtonClass,
  inputClass,
  labelClass,
  ErrorNote,
} from './ui'

type Kind = 'food' | 'cigar'

/** A submitted pairing, frozen at submit time so later edits to the form
 *  don't shift the results underneath you. */
type Submitted =
  | { kind: 'food'; text: string; matchedId: string | null }
  | { kind: 'cigar'; cigar: ResolvedCigar }

type NarrationState =
  | { status: 'idle' }
  | { status: 'signed-out' }
  | { status: 'loading' }
  | { status: 'done'; text: string }
  | { status: 'unavailable' }

const KIND_OPTIONS = [
  { value: 'food', label: 'food' },
  { value: 'cigar', label: 'a cigar' },
] as const satisfies ReadonlyArray<{ value: Kind; label: string }>

const STRENGTH_OPTIONS = [
  { value: '', label: 'not sure' },
  { value: 'mild', label: 'mild' },
  { value: 'medium', label: 'medium' },
  { value: 'full', label: 'full' },
] as const satisfies ReadonlyArray<{ value: CigarStrength | ''; label: string }>

const BRAND_NAMES = [...new Set(CIGAR_BRANDS.map((b) => b.name))].sort((a, b) =>
  a.localeCompare(b),
)

interface Props {
  onRequireAuth: () => void
}

export default function PairingPage({ onRequireAuth }: Props) {
  const { token } = useAuth()
  const [all, setAll] = useState<Bottle[] | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)

  const [kind, setKind] = useState<Kind>('food')
  const [text, setText] = useState('')
  const [brand, setBrand] = useState('')
  const [line, setLine] = useState('')
  const [strength, setStrength] = useState<CigarStrength | ''>('')
  const [wrapper, setWrapper] = useState<Wrapper | ''>('')

  const [submitted, setSubmitted] = useState<Submitted | null>(null)
  /** Food only: a "read as" category chosen after the fact. */
  const [override, setOverride] = useState<string | null>(null)
  const [narration, setNarration] = useState<NarrationState>({ status: 'idle' })
  // Serial for in-flight narration requests, so a slow answer to an earlier
  // pairing can't land on top of a newer one.
  const narrationSeq = useRef(0)

  useEffect(() => {
    let live = true
    getApi()
      .listBottles()
      .then((b) => live && setAll(b))
      .catch((e) => live && setLoadError(e.message))
    return () => {
      live = false
    }
  }, [])

  const cabinet = useMemo(
    () => (all ?? []).filter((b) => familyOf(b.type) === 'alcohol'),
    [all],
  )

  const occasion: Occasion | null = useMemo(() => {
    if (!submitted) return null
    if (submitted.kind === 'cigar') return cigarOccasion(submitted.cigar)
    const id = override ?? submitted.matchedId
    return (id && foodOccasion(id)) || UNKNOWN_OCCASION
  }, [submitted, override])

  const picks = useMemo(
    () => (occasion ? rankPairings(occasion, cabinet) : []),
    [occasion, cabinet],
  )
  const tips = useMemo(
    () => (occasion ? orderTips(occasion, cabinet) : []),
    [occasion, cabinet],
  )
  const knownCigar = useMemo(
    () => lookupCigarBrand(`${brand} ${line}`),
    [brand, line],
  )
  const links: NarrationLink[] = useMemo(
    () => cabinet.map((b) => ({ name: b.name, id: b.id })),
    [cabinet],
  )

  function submit(e: React.FormEvent) {
    e.preventDefault()
    let next: Submitted
    let occ: Occasion
    let request: PairingRequest
    if (kind === 'food') {
      const dish = text.trim()
      if (!dish) return
      const matched = matchFood(dish)
      next = { kind: 'food', text: dish, matchedId: matched?.id ?? null }
      occ = matched ?? UNKNOWN_OCCASION
      request = { kind: 'food', text: dish, reading: matched?.label }
    } else {
      const cigar = resolveCigar({ brand, line, strength, wrapper })
      next = { kind: 'cigar', cigar }
      occ = cigarOccasion(cigar)
      request = {
        kind: 'cigar',
        brand: cigar.brand || undefined,
        line: cigar.line || undefined,
        strength: cigar.strength,
        wrapper: cigar.wrapper ?? undefined,
      }
    }
    request.candidateIds = rankPairings(occ, cabinet).map((p) => p.bottle.id)
    setSubmitted(next)
    setOverride(null)
    requestNarration(request)
  }

  /** The one place the app reaches Haiku: an explicit pairing, signed in. */
  function requestNarration(request: PairingRequest) {
    const seq = ++narrationSeq.current
    if (!token) {
      setNarration({ status: 'signed-out' })
      return
    }
    setNarration({ status: 'loading' })
    getApi()
      .pairingNarration(request, token)
      .then((r) => {
        if (seq !== narrationSeq.current) return
        setNarration(
          r.narration ? { status: 'done', text: r.narration } : { status: 'unavailable' },
        )
      })
      .catch(() => {
        if (seq === narrationSeq.current) setNarration({ status: 'unavailable' })
      })
  }

  const narrationLeads = narration.status === 'loading' || narration.status === 'done'

  return (
    <div className="flex flex-col gap-6">
      <header>
        <h1 className="font-display text-fg text-2xl font-bold sm:text-3xl">Pair</h1>
        <p className="text-muted mt-1 text-sm">
          Say what you’re having. dram says what to order off the menu, and what
          to pour from your cabinet.
        </p>
      </header>

      <Panel>
        <form onSubmit={submit} className="flex flex-col gap-4">
          <Segmented
            label="What are you pairing"
            value={kind}
            onChange={setKind}
            options={KIND_OPTIONS}
          />

          {kind === 'food' ? (
            <Field label="What are you eating?">
              <input
                className={inputClass}
                value={text}
                onChange={(e) => setText(e.target.value)}
                placeholder="ribeye · oysters · spicy green curry · cheese board"
                autoComplete="off"
                enterKeyHint="search"
              />
            </Field>
          ) : (
            <div className="flex flex-col gap-4">
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <Field label="Brand (optional)">
                  <input
                    className={inputClass}
                    list="cigar-brands"
                    value={brand}
                    onChange={(e) => setBrand(e.target.value)}
                    placeholder="Padrón · Arturo Fuente · Montecristo"
                    autoComplete="off"
                  />
                  <datalist id="cigar-brands">
                    {BRAND_NAMES.map((n) => (
                      <option key={n} value={n} />
                    ))}
                  </datalist>
                </Field>
                <Field label="Line or vitola (optional)">
                  <input
                    className={inputClass}
                    value={line}
                    onChange={(e) => setLine(e.target.value)}
                    placeholder="1964 Anniversary Maduro · Torpedo"
                    autoComplete="off"
                  />
                </Field>
              </div>
              {knownCigar && (
                <p className="text-muted -mt-1 font-mono text-xs">
                  {knownCigar.name} — usually {knownCigar.strength}
                  {knownCigar.wrapper ? `, ${knownCigar.wrapper} wrapper` : ''} ·{' '}
                  {knownCigar.notes}
                </p>
              )}
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div className="flex flex-col gap-1.5">
                  <span className={labelClass}>Strength</span>
                  <Segmented
                    label="Cigar strength"
                    value={strength}
                    onChange={setStrength}
                    options={STRENGTH_OPTIONS}
                  />
                </div>
                <Field label="Wrapper (optional)">
                  <select
                    className={inputClass}
                    value={wrapper}
                    onChange={(e) => setWrapper(e.target.value as Wrapper | '')}
                  >
                    <option value="">not sure</option>
                    {WRAPPERS.map((w) => (
                      <option key={w} value={w}>
                        {w}
                      </option>
                    ))}
                  </select>
                </Field>
              </div>
            </div>
          )}

          <div>
            <button
              className={buttonClass}
              disabled={!all || (kind === 'food' && text.trim() === '')}
            >
              Pair it
            </button>
          </div>
        </form>
      </Panel>

      {loadError && <ErrorNote>Couldn’t load the cabinet: {loadError}</ErrorNote>}
      {!all && !loadError && <Spinner label="Opening the cabinet…" />}

      {submitted && occasion && (
        <section className="flex flex-col gap-6" aria-live="polite">
          <div>
            <h2 className="font-display text-fg text-xl font-semibold">
              With{' '}
              {submitted.kind === 'food' ? submitted.text : cigarLabel(submitted.cigar)}
            </h2>
            {submitted.kind === 'food' ? (
              <label className="text-muted mt-2 flex flex-wrap items-center gap-2 text-sm">
                <span className="font-mono text-xs">read as</span>
                <select
                  className={`${fieldClass} max-w-full py-1`}
                  value={occasion.id}
                  onChange={(e) => setOverride(e.target.value)}
                >
                  {FOOD_OCCASIONS.map((o) => (
                    <option key={o.id} value={o.id}>
                      {o.label}
                    </option>
                  ))}
                  <option value={UNKNOWN_OCCASION.id}>something else</option>
                </select>
              </label>
            ) : (
              <p className="text-muted mt-1 font-mono text-xs">
                {submitted.cigar.strength} strength, from {submitted.cigar.strengthSource}
                {submitted.cigar.wrapper ? ` · ${submitted.cigar.wrapper} wrapper` : ''}
                {submitted.cigar.known ? ` · ${submitted.cigar.known.notes}` : ''}
              </p>
            )}
            <p className="text-muted mt-2 text-sm">{occasion.why}</p>
          </div>

          <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
            <div className="flex flex-col gap-6 lg:col-span-2">
              <Panel>
                <SectionTitle
                  hint={occasion.target ? 'from your cabinet' : 'your best-rated'}
                >
                  What to pour
                </SectionTitle>
                {cabinet.length === 0 ? (
                  <p className="text-muted text-sm">
                    Your cabinet is empty — log a few bottles and they’ll be
                    ranked here.
                  </p>
                ) : (
                  <ol className="flex flex-col gap-2.5">
                    {picks.map((p, i) => (
                      <li key={p.bottle.id}>
                        <PickRow
                          pick={p}
                          rank={i + 1}
                          showScore={occasion.target !== null}
                        />
                      </li>
                    ))}
                  </ol>
                )}
              </Panel>

              <Panel>
                <SectionTitle hint="off a menu">What to order</SectionTitle>
                {tips.length === 0 ? (
                  <p className="text-muted text-sm">
                    Pick the closest category above and dram will say what to
                    look for on the list.
                  </p>
                ) : (
                  <ul className="flex flex-col gap-3">
                    {tips.map((t) => (
                      <li key={t.text} className="text-fg/90 text-sm">
                        {capitalize(t.text)}
                        {t.favorite && (
                          <span className="text-muted mt-0.5 block font-mono text-xs">
                            you rated{' '}
                            <BottleLink bottle={t.favorite} /> {t.favorite.avgRating}/10
                          </span>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
              </Panel>
            </div>

            <div
              className={`lg:col-span-1 ${narrationLeads ? 'order-first lg:order-none' : 'order-last'}`}
            >
              <NarrationBox
                state={narration}
                links={links}
                onRequireAuth={onRequireAuth}
              />
            </div>
          </div>
        </section>
      )}
    </div>
  )
}

function NarrationBox({
  state,
  links,
  onRequireAuth,
}: {
  state: NarrationState
  links: NarrationLink[]
  onRequireAuth: () => void
}) {
  if (state.status === 'idle') return null
  return (
    <div className="border-warm/30 bg-warm/5 rounded-lg border p-4">
      <div className="text-warm mb-2 flex items-center gap-1.5 font-mono text-[0.7rem] tracking-wide">
        <span aria-hidden>✦</span> narrated pairing
      </div>
      {state.status === 'loading' && (
        <p className="text-muted flex items-center gap-3 text-sm">
          <span className="border-accent inline-block h-4 w-4 shrink-0 animate-spin rounded-full border-2 border-t-transparent" />
          Thinking it over…
        </p>
      )}
      {state.status === 'done' && (
        <p className="text-fg/90 text-sm leading-relaxed">
          <Narration text={state.text} links={links} />
        </p>
      )}
      {state.status === 'unavailable' && (
        <p className="text-muted text-sm">
          The narrated take isn’t available right now — the picks stand on
          their own.
        </p>
      )}
      {state.status === 'signed-out' && (
        <div className="flex flex-col gap-3">
          <p className="text-muted text-sm">
            Sign in and pair again for a narrated take that reasons over your
            whole cabinet.
          </p>
          <button
            type="button"
            className={`${ghostButtonClass} w-fit px-3 py-1.5 text-xs`}
            onClick={onRequireAuth}
          >
            Sign in
          </button>
        </div>
      )}
    </div>
  )
}

function PickRow({
  pick,
  rank,
  showScore,
}: {
  pick: PairingPick
  rank: number
  showScore: boolean
}) {
  const pct = Math.round(pick.score * 100)
  return (
    <button
      onClick={() => navigate(href.detail(pick.bottle.id))}
      className="border-line bg-panel-2/50 hover:border-accent/60 group w-full rounded-lg border p-3 text-left transition-colors"
    >
      <div className="flex items-start justify-between gap-3">
        <span className="flex min-w-0 items-baseline gap-2">
          <span className="text-muted shrink-0 font-mono text-xs">#{rank}</span>
          <span className="font-display text-fg group-hover:text-accent font-medium break-words transition-colors">
            {pick.bottle.name}
          </span>
        </span>
        <span className="text-muted shrink-0 pt-0.5 text-right font-mono text-xs">
          {pick.bottle.type}
          {showScore && <span className="text-accent"> · {pct}%</span>}
        </span>
      </div>
      {showScore && (
        <div className="bg-line mt-2 h-1 overflow-hidden rounded-full">
          <div className="bg-accent h-full rounded-full" style={{ width: `${pct}%` }} />
        </div>
      )}
      <p className="text-muted mt-2 text-sm">{pick.reason}</p>
    </button>
  )
}

function BottleLink({ bottle }: { bottle: Bottle }) {
  return (
    <button
      type="button"
      onClick={() => navigate(href.detail(bottle.id))}
      className="text-accent hover:text-accent-dim transition-colors"
    >
      {bottle.name}
    </button>
  )
}

function Field({
  label,
  children,
}: {
  label: string
  children: React.ReactNode
}) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className={labelClass}>{label}</span>
      {children}
    </label>
  )
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1)
}
