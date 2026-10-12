/**
 * Shared UI primitives, styled with the family design tokens (panel/line/
 * accent/muted). Reused across every screen so buttons, inputs, and cards
 * stay consistent with interp / the adversarial playground. The component
 * language — one emphasis per element, metadata as a quiet mono line rather
 * than pills, hairlines not shadows — is specified in the dram design system.
 */
import { Fragment, type ReactNode } from 'react'

/** Field chrome without a width — compose with `w-full` (inputClass) or
 *  leave it content-sized for inline selects. */
export const fieldClass =
  'rounded-lg border border-line bg-panel px-3 py-2 text-sm ' +
  'text-fg placeholder-muted outline-none transition-colors focus:border-accent'

export const inputClass = `w-full ${fieldClass}`

export const labelClass =
  'font-mono text-[0.7rem] uppercase tracking-wider text-muted'

export const buttonClass =
  'rounded-lg bg-accent px-4 py-2 text-sm font-medium text-site ' +
  'transition-colors hover:bg-accent-dim disabled:opacity-50 ' +
  'disabled:cursor-not-allowed'

export const ghostButtonClass =
  'rounded-lg border border-line bg-panel px-4 py-2 text-sm font-medium ' +
  'text-fg transition-colors hover:border-accent hover:text-accent'

export function Panel({
  children,
  className = '',
}: {
  children: ReactNode
  className?: string
}) {
  return (
    <section
      className={`border-line bg-panel/60 rounded-xl border p-4 sm:p-5 ${className}`}
    >
      {children}
    </section>
  )
}

export function SectionTitle({
  children,
  hint,
}: {
  children: ReactNode
  hint?: string
}) {
  return (
    <div className="mb-3 flex items-baseline justify-between gap-3">
      <h2 className="font-display text-fg text-base font-semibold">{children}</h2>
      {hint && <span className="text-muted font-mono text-xs">{hint}</span>}
    </div>
  )
}

/** A labelled form field: uppercase mono label over the control. */
export function Field({
  label,
  children,
}: {
  label: string
  children: ReactNode
}) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className={labelClass}>{label}</span>
      {children}
    </label>
  )
}

/** One fact on a Meta line; `lead` paints it accent, `warm` oxblood. Falsy
 *  entries are skipped so callers can pass optional fields inline. */
export type MetaItem = string | { text: string; tone: 'lead' | 'warm' }

/**
 * One mono line of dot-separated facts in muted, with at most one item
 * emphasised: `scotch · Islay · 43% ABV`. Replaces the rows of type / region
 * / strength pills on cards, the detail header and the hub.
 */
export function Meta({
  items,
  className = '',
}: {
  items: ReadonlyArray<MetaItem | false | null | undefined | ''>
  className?: string
}) {
  const shown = items.filter((i): i is MetaItem => Boolean(i))
  return (
    <span
      className={`text-muted flex flex-wrap items-baseline gap-x-1.5 font-mono text-xs ${className}`}
    >
      {shown.map((item, i) => {
        const text = typeof item === 'string' ? item : item.text
        const tone = typeof item === 'string' ? undefined : item.tone
        return (
          <span
            key={`${i}-${text}`}
            className={
              tone === 'lead' ? 'text-accent' : tone === 'warm' ? 'text-warm' : undefined
            }
          >
            {i > 0 && (
              <span className="text-muted mr-1.5 opacity-60" aria-hidden>
                ·
              </span>
            )}
            {text}
          </span>
        )
      })}
    </span>
  )
}

/**
 * A ranked result, the same everywhere a list is scored: recommendations,
 * cross-family picks, pairing picks and the hub's picks. Rank, a wrapping
 * name, an optional mono detail (the type) and score, a score bar when the
 * score exists, and a one-line reason.
 */
export function Row({
  rank,
  name,
  detail,
  score,
  reason,
  onOpen,
}: {
  rank: number
  name: string
  detail?: string
  /** 0..1; omit when the list is ranked by rating alone. */
  score?: number
  reason: string
  onOpen: () => void
}) {
  const pct = score == null ? null : Math.round(score * 100)
  return (
    <button
      onClick={onOpen}
      className="border-line bg-panel-2/50 hover:border-accent/60 group w-full rounded-lg border p-3 text-left transition-colors"
    >
      <div className="flex items-start justify-between gap-3">
        <span className="flex min-w-0 items-baseline gap-2">
          <span className="text-muted shrink-0 font-mono text-xs">#{rank}</span>
          <span className="font-display text-fg group-hover:text-accent font-medium break-words transition-colors">
            {name}
          </span>
        </span>
        {(detail || pct != null) && (
          <span className="text-muted shrink-0 pt-0.5 text-right font-mono text-xs">
            {detail}
            {pct != null && (
              <span className="text-accent">
                {detail ? ' · ' : ''}
                {pct}%
              </span>
            )}
          </span>
        )}
      </div>
      {pct != null && (
        <div className="bg-line mt-2 h-1 overflow-hidden rounded-full">
          <div className="bg-accent h-full rounded-full" style={{ width: `${pct}%` }} />
        </div>
      )}
      <p className="text-muted mt-2 text-sm">{reason}</p>
    </button>
  )
}

/**
 * Joined segmented control — the same shape as the nav's section switcher,
 * as a radio group of buttons for forms (food | cigar, mild | medium | full).
 * Each segment is a ≥44px tap target.
 */
export function Segmented<T extends string>({
  value,
  onChange,
  options,
  label,
}: {
  value: T
  onChange: (next: T) => void
  options: ReadonlyArray<{ value: T; label: string }>
  /** Accessible name for the group. */
  label: string
}) {
  return (
    <div
      role="radiogroup"
      aria-label={label}
      className="border-line bg-panel flex w-fit max-w-full items-stretch overflow-hidden rounded-full border"
    >
      {options.map((o, i) => (
        <Fragment key={o.value}>
          {i > 0 && <span className="bg-line w-px shrink-0" aria-hidden />}
          <button
            type="button"
            role="radio"
            aria-checked={o.value === value}
            onClick={() => onChange(o.value)}
            className={`min-h-[44px] px-4 font-mono text-xs whitespace-nowrap transition-colors ${
              o.value === value
                ? 'bg-accent/15 text-accent'
                : 'text-muted hover:text-accent'
            }`}
          >
            {o.label}
          </button>
        </Fragment>
      ))}
    </div>
  )
}

/** Star-ish rating out of 10, shown as a compact numeric chip. */
export function RatingBadge({ value }: { value: number | null }) {
  if (value == null) {
    return <span className="text-muted font-mono text-xs">no notes yet</span>
  }
  return (
    <span className="text-warm inline-flex items-baseline gap-1 font-mono">
      <span className="text-lg font-medium">{value.toFixed(1)}</span>
      <span className="text-muted text-xs">/ 10</span>
    </span>
  )
}

export function Spinner({ label = 'Loading…' }: { label?: string }) {
  return (
    <div className="text-muted flex items-center gap-3 py-10 font-mono text-sm">
      <span className="border-accent inline-block h-4 w-4 animate-spin rounded-full border-2 border-t-transparent" />
      {label}
    </div>
  )
}

/** A sentence the app needs you to read: `danger` for a failure with its
 *  message, `soft` for a fallback the app handled on its own. */
export function Notice({
  tone = 'danger',
  children,
}: {
  tone?: 'danger' | 'soft'
  children: ReactNode
}) {
  if (tone === 'soft') {
    return (
      <div className="border-warm/30 bg-warm/5 text-warm/90 rounded-lg border px-3 py-2 text-xs">
        {children}
      </div>
    )
  }
  return (
    <div className="rounded-lg border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-300">
      {children}
    </div>
  )
}
