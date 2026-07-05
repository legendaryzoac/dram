/**
 * Minimal app header. dram is used mostly as a phone app, so the top nav is
 * just the brand ("zw ~ / dram", with dram linking home) plus an optional
 * live-backend badge — no cross-site links. The SiteFooter keeps the external
 * links (GitHub / LinkedIn / Email).
 */
export default function SiteNav({ badge }: { badge?: string }) {
  return (
    <nav className="bg-site/85 border-line fixed inset-x-0 top-0 z-50 flex h-[60px] items-center justify-between gap-x-3 border-b px-5 backdrop-blur-md sm:px-10">
      <div className="flex min-w-0 shrink items-baseline gap-2.5">
        <span className="text-accent font-mono text-sm tracking-wider whitespace-nowrap">
          zw ~
        </span>
        <span className="text-muted font-mono text-xs">/</span>
        <a
          href="#/"
          className="text-accent truncate font-mono text-xs"
        >
          dram
        </a>
      </div>
      {badge && (
        <span className="border-line bg-panel text-muted hidden rounded-full border px-3 py-1 font-mono text-[0.7rem] tracking-wide whitespace-nowrap md:inline">
          {badge}
        </span>
      )}
    </nav>
  )
}
