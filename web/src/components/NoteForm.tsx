/**
 * Log-or-edit-a-tasting-note form (auth-gated). Three free-text prose fields,
 * a 1–10 rating, and eight flavor-tag sliders (0..5). The wire fields are
 * always nose / palate / finish; coffee just wears them as aroma / flavor /
 * aftertaste. Coffee notes also take optional brew metadata (grinder, method,
 * grind size, ratio, time) with select-or-type suggestions from gear already
 * used. The radar preview updates live as the sliders move. Built phone-first:
 * single column, big tap targets, sliders that work with a thumb.
 *
 * With `editNote` set the form prefills and PUTs an edit (the API allows only
 * the note's author); otherwise it POSTs a new note.
 */
import { useState } from 'react'
import type { FlavorTags, NewNoteInput, NoteBrew, TastingNote } from '../lib/types'
import { EMPTY_FLAVOR, FLAVOR_AXES, isCoffee } from '../lib/types'
import { getApi } from '../lib/api'
import { NOTE_FIELD_LABELS } from '../lib/noteFields'
import { useAuth } from './AuthContext'
import RadarChart from './RadarChart'
import {
  Field,
  buttonClass,
  ghostButtonClass,
  inputClass,
  labelClass,
  Notice,
} from './ui'

export interface BrewSuggestions {
  grinders: string[]
  methods: string[]
}

interface Props {
  bottleId: string
  /** The bottle's beverage type — drives labels and the brew section. */
  bottleType: string
  /** Present when editing an existing note; prefills and PUTs instead. */
  editNote?: TastingNote
  /** Select-or-type options for the brew fields (from gear already used). */
  brewSuggestions?: BrewSuggestions
  onSaved: () => void
  onCancel: () => void
}

export default function NoteForm({
  bottleId,
  bottleType,
  editNote,
  brewSuggestions,
  onSaved,
  onCancel,
}: Props) {
  const { token } = useAuth()
  const [nose, setNose] = useState(editNote?.nose ?? '')
  const [palate, setPalate] = useState(editNote?.palate ?? '')
  const [finish, setFinish] = useState(editNote?.finish ?? '')
  const [rating, setRating] = useState(editNote?.rating ?? 7)
  const [flavor, setFlavor] = useState<FlavorTags>({
    ...EMPTY_FLAVOR,
    ...editNote?.flavorTags,
  })
  const [grinder, setGrinder] = useState(editNote?.brew?.grinder ?? '')
  const [method, setMethod] = useState(editNote?.brew?.method ?? '')
  const [grindSize, setGrindSize] = useState(editNote?.brew?.grindSize ?? '')
  const [ratio, setRatio] = useState(editNote?.brew?.ratio ?? '')
  const [time, setTime] = useState(editNote?.brew?.time ?? '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const coffee = isCoffee(bottleType)
  const labels = NOTE_FIELD_LABELS[coffee ? 'coffee' : 'alcohol']
  const editing = Boolean(editNote)

  function setAxis(key: keyof FlavorTags, value: number) {
    setFlavor((f) => ({ ...f, [key]: value }))
  }

  function buildBrew(): NoteBrew | undefined {
    if (!coffee) return undefined
    const brew: NoteBrew = {}
    if (grinder.trim()) brew.grinder = grinder.trim()
    if (method.trim()) brew.method = method.trim()
    if (grindSize.trim()) brew.grindSize = grindSize.trim()
    if (ratio.trim()) brew.ratio = ratio.trim()
    if (time.trim()) brew.time = time.trim()
    return Object.keys(brew).length > 0 ? brew : undefined
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!token) return
    setBusy(true)
    setError(null)
    const input: NewNoteInput = {
      nose,
      palate,
      finish,
      rating,
      flavorTags: flavor,
      brew: buildBrew(),
    }
    try {
      const api = getApi()
      if (editNote) await api.updateNote(bottleId, editNote.id, input, token)
      else await api.addNote(bottleId, input, token)
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

          {coffee && (
            <fieldset className="border-line rounded-xl border border-dashed p-3">
              <legend className={`${labelClass} px-1`}>
                How it was brewed (optional)
              </legend>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <Field label="Grinder">
                  <input
                    className={inputClass}
                    list="brew-grinders"
                    value={grinder}
                    onChange={(e) => setGrinder(e.target.value)}
                    placeholder="Fellow Ode Gen 2"
                  />
                  <datalist id="brew-grinders">
                    {(brewSuggestions?.grinders ?? []).map((g) => (
                      <option key={g} value={g} />
                    ))}
                  </datalist>
                </Field>
                <Field label="Method / machine">
                  <input
                    className={inputClass}
                    list="brew-methods"
                    value={method}
                    onChange={(e) => setMethod(e.target.value)}
                    placeholder="V60 pour over"
                  />
                  <datalist id="brew-methods">
                    {(brewSuggestions?.methods ?? []).map((m) => (
                      <option key={m} value={m} />
                    ))}
                  </datalist>
                </Field>
                <Field label="Grind size">
                  <input
                    className={inputClass}
                    value={grindSize}
                    onChange={(e) => setGrindSize(e.target.value)}
                    placeholder="4.33"
                  />
                </Field>
                <div className="grid grid-cols-2 gap-3">
                  <Field label="Ratio">
                    <input
                      className={inputClass}
                      value={ratio}
                      onChange={(e) => setRatio(e.target.value)}
                      placeholder="1:15"
                    />
                  </Field>
                  <Field label="Time">
                    <input
                      className={inputClass}
                      value={time}
                      onChange={(e) => setTime(e.target.value)}
                      placeholder="3:02"
                    />
                  </Field>
                </div>
              </div>
            </fieldset>
          )}
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

      {error && <Notice>{error}</Notice>}

      <div className="flex gap-3">
        <button className={buttonClass} disabled={busy}>
          {busy ? 'Saving…' : editing ? 'Save changes' : 'Save tasting note'}
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
