/**
 * One group tasting's grouped palate: everyone's notes from that code read as
 * one drinker — the table's radar, mean rating, who tasted, and the bottles
 * the table liked best. Kept apart from the owner's own palate on the hub.
 */
import { topAxes, type TastingPalate as Palate } from '../lib/hub'
import { href } from '../lib/router'
import RadarChart from './RadarChart'
import { Meta } from './ui'

export default function TastingPalate({
  palate,
  /** Link favourites to their bottle pages (host only — the guest screen
   *  stays off detail pages, which call the recommender). */
  linkBottles = false,
}: {
  palate: Palate
  linkBottles?: boolean
}) {
  if (!palate.palate || palate.noteCount === 0) {
    return (
      <p className="text-muted text-sm">
        No notes yet — the table’s palate fills in as people log.
      </p>
    )
  }
  const leans = topAxes(palate.palate)
  return (
    <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
      <div className="mx-auto shrink-0">
        <RadarChart flavor={palate.palate} size={200} />
      </div>
      <div className="flex min-w-0 flex-1 flex-col gap-3">
        <Meta
          items={[
            palate.avgRating != null && { text: `${palate.avgRating} / 10 avg`, tone: 'warm' },
            `${palate.noteCount} ${palate.noteCount === 1 ? 'note' : 'notes'}`,
            `${palate.tasters.length} ${palate.tasters.length === 1 ? 'taster' : 'tasters'}`,
          ]}
        />
        {leans.length > 0 && (
          <p className="text-fg/90 text-sm">
            The table leans <span className="text-accent">{leans.join(' and ')}</span>.
          </p>
        )}
        {palate.favourites.length > 0 && (
          <div>
            <p className="text-muted mb-1 font-mono text-[0.7rem] tracking-wider uppercase">
              Table favourites
            </p>
            <ol className="flex flex-col gap-1 text-sm">
              {palate.favourites.map((f, i) => (
                <li key={f.bottleId} className="flex items-baseline justify-between gap-3">
                  <span className="min-w-0 truncate">
                    <span className="text-muted mr-2 font-mono text-xs">#{i + 1}</span>
                    {linkBottles ? (
                      <a href={href.detail(f.bottleId)} className="text-fg hover:text-accent">
                        {f.name}
                      </a>
                    ) : (
                      <span className="text-fg">{f.name}</span>
                    )}
                  </span>
                  <span className="text-warm shrink-0 font-mono text-xs">
                    {f.avgRating}/10 · {f.noteCount}
                  </span>
                </li>
              ))}
            </ol>
          </div>
        )}
        <Meta items={palate.tasters.map(([name, n]) => `${name} ${n}`)} />
      </div>
    </div>
  )
}
