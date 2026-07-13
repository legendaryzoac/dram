/**
 * Log-a-tasting-note form (auth-gated). Three free-text prose fields, a 1–10
 * rating, and eight flavor-tag sliders (0..5). The wire fields are always
 * nose / palate / finish; coffee just wears them as aroma / flavor /
 * aftertaste. The radar preview updates live as the sliders move, so you see
 * the profile you're describing before you save. Built phone-first: single
 * column, big tap targets, sliders that work with a thumb.
 */
import { useState } from 'react'
import type { FlavorTags, NewNoteInput } from '../lib/types'
import { EMPTY_FLAVOR, FLAVOR_AXES, isCoffee } from '../lib/types'
import { getApi } from '../lib/api'
import { useAuth } from './AuthContext'
import RadarChart from './RadarChart'
import {
  buttonClass,
  ghostButtonClass,
  inputClass,
  labelClass,
  ErrorNote,
} from './ui'

/** Display labels + placeholders for the three prose fields, per family. */
export const NOTE_FIELD_LABELS = {
  alcohol: {
    nose: 'Nose',
    palate: 'Palate',
    finish: 'Finish',
    nosePh: 'What do you smell? Citrus, smoke, honey…',
    palatePh: 'How does it taste? Body, sweetness, spice…',
    finishPh: 'How does it end? Length, warmth, aftertaste…',
  },
  coffee: {
    nose: 'Aroma',
    palate: 'Flavor',
    finish: 'Aftertaste',
    nosePh: 'What do you smell? Florals, berries, cocoa…',
    palatePh: 'How does it taste? Sweetness, acidity, body…',
    finishPh: 'How does it linger? Clean, syrupy, drying…',
  },
} as const

interface Props {
  bottleId: string
  /** The bottle's beverage type — drives the coffee-vs-alcohol field labels. */
  bottleType: string
  onSaved: () => void
  onCancel: () => void
}

export default function NoteForm({
  bottleId,
  bottleType,
  onSaved,
  onCancel,
}: Props) {
  const { token } = useAuth()
  const [nose, setNose] = useState('')
  const [palate, setPalate] = useState('')
  const [finish, setFinish] = useState('')
  const [rating, setRating] = useState(7)
  const [flavor, setFlavor] = useState<FlavorTags>({ ...EMPTY_FLAVOR })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const labels =
    NOTE_FIELD_LABELS[isCoffee(bottleType) ? 'coffee' : 'alcohol']

  function setAxis(key: keyof FlavorTags, value: number) {
    setFlavor((f) => ({ ...f, [key]: value }))
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!token) return
    setBusy(true)
    setError(null)
    const input: NewNoteInput = { nose, palate, finish, rating, flavorTags: flavor }
    try {
      await getApi().addNote(bottleId, input, token)
      onSaved()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save note')
      setBusy(false)
    }
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-5">
      <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
        {/* left: the words */}
        <div className="flex flex-col gap-4">
          <Field label={labels.nose}>
            <textarea
              className={`${inputClass} min-h-[70px] resize-y`}
              placeholder={labels.nosePh}
              value={nose}
              onChange={(e) => setNose(e.target.value)}
            />
          </Field>
          <Field label={labels.palate}>
            <textarea
              className={`${inputClass} min-h-[70px] resize-y`}
              placeholder={labels.palatePh}
              value={palate}
              onChange={(e) => setPalate(e.target.value)}
            />
          </Field>
          <Field label={labels.finish}>
            <textarea
              className={`${inputClass} min-h-[70px] resize-y`}
              placeholder={labels.finishPh}
              value={finish}
              onChange={(e) => setFinish(e.target.value)}
            />
          </Field>

          <Field label={`Rating — ${rating} / 10`}>
            <input
              type="range"
              min={1}
              max={10}
              step={1}
              value={rating}
              onChange={(e) => setRating(Number(e.target.value))}
              className="w-full"
            />
          </Field>
        </div>

        {/* right: sliders + live radar */}
        <div className="flex flex-col gap-4">
          <div className="border-line bg-panel-2/40 rounded-xl border p-4">
            <RadarChart flavor={flavor} showValues size={240} />
            <p className="text-muted mt-1 text-center font-mono text-[0.7rem]">
              live flavor preview
            </p>
          </div>

          <div className="flex flex-col gap-3">
            {FLAVOR_AXES.map((key) => (
              <label key={key} className="flex items-center gap-3">
                <span className="text-muted w-14 font-mono text-xs capitalize">
                  {key}
                </span>
                <input
                  type="range"
                  min={0}
                  max={5}
                  step={1}
                  value={flavor[key]}
                  onChange={(e) => setAxis(key, Number(e.target.value))}
                  className="flex-1"
                  aria-label={`${key} intensity`}
                />
                <span className="text-warm w-4 text-right font-mono text-sm">
                  {flavor[key]}
                </span>
              </label>
            ))}
          </div>
        </div>
      </div>

      {error && <ErrorNote>{error}</ErrorNote>}

      <div className="flex gap-3">
        <button className={buttonClass} disabled={busy}>
          {busy ? 'Saving…' : 'Save tasting note'}
        </button>
        <button
          type="button"
          className={ghostButtonClass}
          onClick={onCancel}
          disabled={busy}
        >
          Cancel
        </button>
      </div>
    </form>
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
