/**
 * Minimal app header. dram is used mostly as a phone app, so the top nav is
 * the brand ("zw ~ / dram") on the left and the family switcher on the right:
 * a joined segmented control (cabinet | coffee) whose halves are full-height
 * ≥44px tap targets, plus an optional live-backend badge on wider screens.
 * The SiteFooter keeps the external links (GitHub / LinkedIn / Email).
 */
import type { BeverageFamily } from '../lib/types'
import { href } from '../lib/router'

export default function SiteNav({
  badge,
  active,
}: {
  badge?: string
  /** Which family tab to highlight; undefined on detail/form routes. */
  active?: BeverageFamily
}) {
  return (
    <nav className="bg-site/85 border-line fixed inset-x-0 top-0 z-50 flex h-[60px] items-center justify-between gap-x-3 border-b px-4 backdrop-blur-md sm:px-10">
      <div className="flex min-w-0 shrink items-baseline gap-2.5">
        <span className="text-accent font-mono text-sm tracking-wider whitespace-nowrap">
          zw ~
        </span>
        <span className="text-muted font-mono text-xs">/</span>
        <a href="#/" className="text-accent truncate font-mono text-xs">
          dram
        </a>
      </div>

      <div className="flex items-center gap-3">
        {badge && (
          <span className="border-line bg-panel text-muted hidden rounded-full border px-3 py-1 font-mono text-[0.7rem] tracking-wide whitespace-nowrap md:inline">
            {badge}
          </span>
        )}
        {/* Segmented family switcher: one joined pill, two wide halves. Each
            half is a ≥44px-tall tap target, so a thumb lands cleanly on a
            phone; the divider marks the boundary. */}
        <div className="border-line bg-panel flex shrink-0 items-stretch overflow-hidden rounded-full border">
          <TabLink to={href.list('alcohol')} current={active === 'alcohol'}>
            cabinet
          </TabLink>
          <span className="bg-line w-px" aria-hidden />
          <TabLink to={href.list('coffee')} current={active === 'coffee'}>
            coffee
          </TabLink>
        </div>
      </div>
    </nav>
  )
}

function TabLink({
  to,
  current,
  children,
}: {
  to: string
  current: boolean
  children: React.ReactNode
}) {
  return (
    <a
      href={to}
      aria-current={current ? 'page' : undefined}
      className={`flex min-h-[44px] items-center px-5 font-mono text-xs whitespace-nowrap transition-colors ${
        current
          ? 'bg-accent/15 text-accent'
          : 'text-muted hover:text-accent'
      }`}
    >
      {children}
    </a>
  )
}
