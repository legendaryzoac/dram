/**
 * Add / edit a bottle or coffee (auth-gated, routes `#/add`, `#/add/coffee`,
 * and `#/bottles/:id/edit`). Name / producer / region / type / ABV / price,
 * plus per-category fields: grape (wine), style (spirits — and the free-text
 * description for `other`), roast + process (coffee). The type dropdown is
 * driven by TYPE_GROUPS in lib/types. On add it posts a new bottle; on edit
 * it PUTs a partial update. Redirects to the bottle's detail page.
 */
import { useEffect, useState } from 'react'
import type { BeverageFamily, Bottle, NewBottleInput } from '../lib/types'
import {
  BOTTLE_TYPES,
  ROAST_LEVELS,
  TYPE_GROUPS,
  familyOf,
  isCoffee,
  isSpirit,
  isWine,
  normalizeRoast,
} from '../lib/types'
import { getApi } from '../lib/api'
import { href, navigate } from '../lib/router'
import { useAuth } from './AuthContext'
import {
  Panel,
  buttonClass,
  ghostButtonClass,
  inputClass,
  labelClass,
  ErrorNote,
  Spinner,
} from './ui'

interface Props {
  /** Present when editing; absent when adding. */
  editId?: string
  /** Which tab launched the add form; picks the default type. */
  initialFamily?: BeverageFamily
}

export default function BottleForm({ editId, initialFamily }: Props) {
  const { token } = useAuth()
  const editing = Boolean(editId)

  const [name, setName] = useState('')
  const [producer, setProducer] = useState('')
  const [region, setRegion] = useState('')
  const [type, setType] = useState<string>(
    initialFamily === 'coffee' ? 'coffee' : 'scotch',
  )
  const [grape, setGrape] = useState('')
  const [style, setStyle] = useState('')
  const [roast, setRoast] = useState('')
  const [process, setProcess] = useState('')
  const [abv, setAbv] = useState('43')
  const [price, setPrice] = useState('')
  const [loading, setLoading] = useState(editing)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function hydrate(b: Bottle) {
    setName(b.name)
    setProducer(b.producer)
    setRegion(b.region)
    setType(b.type)
    setGrape(b.grape ?? '')
    setStyle(b.style ?? '')
    setRoast(b.roast === undefined ? '' : normalizeRoast(b.roast))
    setProcess(b.process ?? '')
    setAbv(String(b.abv))
    setPrice(b.price == null ? '' : String(b.price))
  }

  // Prefill when editing.
  useEffect(() => {
    if (!editId) return
    let live = true
    getApi()
      .getBottle(editId)
      .then(({ bottle }) => {
        if (!live) return
        hydrate(bottle)
        setLoading(false)
      })
      .catch((e) => {
        if (live) {
          setError(e.message)
          setLoading(false)
        }
      })
    return () => {
      live = false
    }
  }, [editId])

  const coffee = isCoffee(type)

  /** Per-type fields: send the trimmed value when this type uses the field,
   *  null otherwise so an edit that switches type clears stale values. */
  const perType = (applies: boolean, value: string): string | null =>
    applies && value.trim() !== '' ? value.trim() : null

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!token) return
    setBusy(true)
    setError(null)
    const input: NewBottleInput = {
      name: name.trim(),
      producer: producer.trim(),
      region: region.trim(),
      type,
      // Coffee has no meaningful ABV; store an honest 0.
      abv: coffee ? 0 : Number(abv),
      price: price.trim() === '' ? null : Number(price),
      grape: perType(isWine(type), grape),
      style: perType(isSpirit(type), style),
      roast: perType(coffee, roast),
      process: perType(coffee, process),
    }
    try {
      const api = getApi()
      const saved = editId
        ? await api.updateBottle(editId, input, token)
        : await api.createBottle(input, token)
      navigate(href.detail(saved.id))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save bottle')
      setBusy(false)
    }
  }

  if (loading) return <Spinner label="Loading bottle…" />

  const backHref = editId ? href.detail(editId) : href.list(familyOf(type))

  return (
    <div className="mx-auto max-w-xl">
      <button
        onClick={() => navigate(backHref)}
        className="text-muted hover:text-accent mb-4 font-mono text-sm"
      >
        ← back
      </button>
      <Panel>
        <h1 className="font-display text-fg mb-4 text-xl font-semibold">
          {editing
            ? coffee
              ? 'Edit coffee'
              : 'Edit bottle'
            : coffee
              ? 'Add a coffee'
              : 'Add a bottle'}
        </h1>
        <form onSubmit={submit} className="flex flex-col gap-4">
          <Field label="Name">
            <input
              className={inputClass}
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={coffee ? 'Ethiopia Yirgacheffe' : 'Lagavulin 16'}
              required
            />
          </Field>
          <Field label={coffee ? 'Roaster' : 'Producer'}>
            <input
              className={inputClass}
              value={producer}
              onChange={(e) => setProducer(e.target.value)}
              placeholder={coffee ? 'Counter Culture Coffee' : 'Lagavulin'}
              required
            />
          </Field>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label={coffee ? 'Origin' : 'Region'}>
              <input
                className={inputClass}
                value={region}
                onChange={(e) => setRegion(e.target.value)}
                placeholder={coffee ? 'Yirgacheffe, Ethiopia' : 'Islay'}
                required
              />
            </Field>
            <Field label="Type">
              <select
                className={inputClass}
                value={type}
                onChange={(e) => {
                  const next = e.target.value
                  // Leaving coffee re-exposes the ABV field; don't leave the
                  // coffee sentinel 0 (or blank) sitting in it.
                  if (
                    isCoffee(type) &&
                    !isCoffee(next) &&
                    (abv.trim() === '' || Number(abv) === 0)
                  ) {
                    setAbv('43')
                  }
                  setType(next)
                }}
              >
                {TYPE_GROUPS.map((g) => (
                  <optgroup key={g.id} label={g.label}>
                    {g.types.map((t) => (
                      <option key={t} value={t}>
                        {t}
                      </option>
                    ))}
                  </optgroup>
                ))}
                {/* A stored type outside the canon (an older or API-written
                    entry) stays selectable rather than silently vanishing. */}
                {!(BOTTLE_TYPES as readonly string[]).includes(type) && (
                  <optgroup label="As stored">
                    <option value={type}>{type}</option>
                  </optgroup>
                )}
              </select>
            </Field>
          </div>
          {isWine(type) && (
            <Field label="Grape">
              <input
                className={inputClass}
                value={grape}
                onChange={(e) => setGrape(e.target.value)}
                placeholder="Cabernet Sauvignon"
              />
            </Field>
          )}
          {isSpirit(type) && (
            <Field label={type === 'other' ? 'What is it?' : 'Style (optional)'}>
              <input
                className={inputClass}
                value={style}
                onChange={(e) => setStyle(e.target.value)}
                placeholder={
                  type === 'other'
                    ? 'sake · cider · baijiu · aquavit'
                    : 'single malt · cask strength · reposado · london dry'
                }
              />
            </Field>
          )}
          {coffee && (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Field label="Roast (optional)">
                <select
                  className={inputClass}
                  value={roast}
                  onChange={(e) => setRoast(e.target.value)}
                >
                  <option value="">—</option>
                  {ROAST_LEVELS.map((r) => (
                    <option key={r} value={r}>
                      {r}
                    </option>
                  ))}
                  {/* A stored roast outside the canon (older free-form entry)
                      stays selectable rather than silently vanishing. */}
                  {roast !== '' && !ROAST_LEVELS.includes(roast as never) && (
                    <option value={roast}>{roast}</option>
                  )}
                </select>
              </Field>
              <Field label="Process (optional)">
                <input
                  className={inputClass}
                  value={process}
                  onChange={(e) => setProcess(e.target.value)}
                  placeholder="washed / natural / honey"
                />
              </Field>
            </div>
          )}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            {!coffee && (
              <Field label="ABV %">
                <input
                  className={inputClass}
                  type="number"
                  min={0}
                  max={90}
                  step="0.1"
                  value={abv}
                  onChange={(e) => setAbv(e.target.value)}
                  required
                />
              </Field>
            )}
            <Field label="Price (optional)">
              <input
                className={inputClass}
                type="number"
                min={0}
                step="1"
                value={price}
                onChange={(e) => setPrice(e.target.value)}
                placeholder="—"
              />
            </Field>
          </div>

          {error && <ErrorNote>{error}</ErrorNote>}

          <div className="flex gap-3">
            <button className={buttonClass} disabled={busy}>
              {busy
                ? 'Saving…'
                : editing
                  ? 'Save changes'
                  : coffee
                    ? 'Add coffee'
                    : 'Add bottle'}
            </button>
            <button
              type="button"
              className={ghostButtonClass}
              onClick={() => navigate(backHref)}
              disabled={busy}
            >
              Cancel
            </button>
          </div>
        </form>
      </Panel>
    </div>
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
