/**
 * Add / edit a bottle (auth-gated, routes `#/add` and `#/bottles/:id/edit`).
 * Name / producer / region / type / ABV / price. On add it posts a new bottle;
 * on edit it PUTs a partial update. Redirects to the bottle's detail page.
 */
import { useEffect, useState } from 'react'
import type { Bottle, BottleType, NewBottleInput } from '../lib/types'
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

const TYPES: BottleType[] = [
  'scotch',
  'bourbon',
  'rye',
  'irish',
  'red wine',
  'white wine',
]

/** Wine types get a grape-variety field, since the grape matters more than the
 *  producer for wine. */
const isWine = (t: string) => t === 'red wine' || t === 'white wine'

interface Props {
  /** Present when editing; absent when adding. */
  editId?: string
}

export default function BottleForm({ editId }: Props) {
  const { token } = useAuth()
  const editing = Boolean(editId)

  const [name, setName] = useState('')
  const [producer, setProducer] = useState('')
  const [region, setRegion] = useState('')
  const [type, setType] = useState<string>('scotch')
  const [grape, setGrape] = useState('')
  const [abv, setAbv] = useState('43')
  const [price, setPrice] = useState('')
  const [loading, setLoading] = useState(editing)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

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

  function hydrate(b: Bottle) {
    setName(b.name)
    setProducer(b.producer)
    setRegion(b.region)
    setType(b.type)
    setGrape(b.grape ?? '')
    setAbv(String(b.abv))
    setPrice(b.price == null ? '' : String(b.price))
  }

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
      abv: Number(abv),
      price: price.trim() === '' ? null : Number(price),
      // Only send a grape for wines; trims to undefined when blank/cleared.
      grape: isWine(type) && grape.trim() !== '' ? grape.trim() : undefined,
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

  return (
    <div className="mx-auto max-w-xl">
      <button
        onClick={() =>
          navigate(editId ? href.detail(editId) : href.list())
        }
        className="text-muted hover:text-accent mb-4 font-mono text-sm"
      >
        ← back
      </button>
      <Panel>
        <h1 className="font-display text-fg mb-4 text-xl font-semibold">
          {editing ? 'Edit bottle' : 'Add a bottle'}
        </h1>
        <form onSubmit={submit} className="flex flex-col gap-4">
          <Field label="Name">
            <input
              className={inputClass}
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Lagavulin 16"
              required
            />
          </Field>
          <Field label="Producer">
            <input
              className={inputClass}
              value={producer}
              onChange={(e) => setProducer(e.target.value)}
              placeholder="Lagavulin"
              required
            />
          </Field>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="Region">
              <input
                className={inputClass}
                value={region}
                onChange={(e) => setRegion(e.target.value)}
                placeholder="Islay"
                required
              />
            </Field>
            <Field label="Type">
              <select
                className={inputClass}
                value={type}
                onChange={(e) => setType(e.target.value)}
              >
                {TYPES.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
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
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="ABV %">
              <input
                className={inputClass}
                type="number"
                min={0}
                max={80}
                step="0.1"
                value={abv}
                onChange={(e) => setAbv(e.target.value)}
                required
              />
            </Field>
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
              {busy ? 'Saving…' : editing ? 'Save changes' : 'Add bottle'}
            </button>
            <button
              type="button"
              className={ghostButtonClass}
              onClick={() =>
                navigate(editId ? href.detail(editId) : href.list())
              }
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
