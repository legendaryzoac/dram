/**
 * Shared UI primitives, styled with the family design tokens (panel/line/
 * accent/muted). Reused across every screen so buttons, inputs, and cards
 * stay consistent with interp / the adversarial playground.
 */
import type { ReactNode } from 'react'

export const inputClass =
  'w-full rounded-lg border border-line bg-panel px-3 py-2 text-sm ' +
  'text-fg placeholder-muted outline-none transition-colors focus:border-accent'

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

/** Small rounded pill — used for type/region tags and rating chips. */
export function Tag({
  children,
  tone = 'muted',
}: {
  children: ReactNode
  tone?: 'muted' | 'accent' | 'warm'
}) {
  const tones: Record<string, string> = {
    muted: 'border-line bg-panel-2 text-muted',
    accent: 'border-accent/40 bg-accent/10 text-accent',
    warm: 'border-warm/40 bg-warm/10 text-warm',
  }
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2.5 py-0.5 font-mono text-[0.7rem] tracking-wide ${tones[tone]}`}
    >
      {children}
    </span>
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

export function ErrorNote({ children }: { children: ReactNode }) {
  return (
    <div className="rounded-lg border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-300">
      {children}
    </div>
  )
}
