/**
 * "Bottles like this" — renders a RecommendationResult end to end:
 *
 *   - a `basis` badge translating the recommender layer into plain language
 *     ("matched on metadata" / "matched on tasting notes" / "AI-picked"),
 *   - the ranked recommendations with their score bar and free-text `reason`,
 *   - the `narration` prose when the narrated layer produced it,
 *   - a subtle banner when the result is `degraded` (a lower layer answered).
 */
import { useEffect, useState } from 'react'
import type {
  RecommendationBasis,
  RecommendationResult,
} from '../lib/types'
import { getApi } from '../lib/api'
import { href, navigate } from '../lib/router'
import { Panel, SectionTitle, Spinner, ErrorNote } from './ui'

/** Human-readable label + tone for each recommender basis. */
const BASIS_META: Record<
  RecommendationBasis,
  { label: string; className: string; blurb: string }
> = {
  structured: {
    label: 'matched on metadata',
    className: 'border-line bg-panel-2 text-muted',
    blurb: 'Ranked by structured similarity — region, type, and flavor tags.',
  },
  text: {
    label: 'matched on tasting notes',
    className: 'border-accent/40 bg-accent/10 text-accent',
    blurb:
      'Ranked by what these bottles actually taste like, from your nose / palate / finish notes.',
  },
  narrated: {
    label: 'AI-picked',
    className: 'border-warm/40 bg-warm/10 text-warm',
    blurb: 'Reasoned over your tasting history and explained below.',
  },
}

export default function RecommendationsPanel({
  bottleId,
}: {
  bottleId: string
}) {
  const [result, setResult] = useState<RecommendationResult | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let live = true
    setResult(null)
    setError(null)
    getApi()
      .getRecommendations(bottleId)
      .then((r) => live && setResult(r))
      .catch((e) => live && setError(e.message))
    return () => {
      live = false
    }
  }, [bottleId])

  return (
    <Panel>
      <SectionTitle hint="recommender">Bottles like this</SectionTitle>

      {error && <ErrorNote>Couldn’t load recommendations: {error}</ErrorNote>}
      {!result && !error && <Spinner label="Scoring the cabinet…" />}

      {result && (
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <span
              className={`inline-flex w-fit items-center rounded-full border px-2.5 py-0.5 font-mono text-[0.7rem] tracking-wide ${BASIS_META[result.basis].className}`}
            >
              {BASIS_META[result.basis].label}
            </span>
            <p className="text-muted text-xs">{BASIS_META[result.basis].blurb}</p>
          </div>

          {result.degraded && (
            <div className="border-warm/30 bg-warm/5 text-warm/90 rounded-lg border px-3 py-2 text-xs">
              Heads up — the richer recommender was unavailable, so this fell back
              to a simpler match.
            </div>
          )}

          {result.recommendations.length === 0 ? (
            <p className="text-muted text-sm">
              Nothing close enough to recommend yet — log a few more bottles.
            </p>
          ) : (
            <ol className="flex flex-col gap-2.5">
              {result.recommendations.map((rec, i) => (
                <li key={rec.bottleId}>
                  <button
                    onClick={() => navigate(href.detail(rec.bottleId))}
                    className="border-line bg-panel-2/50 hover:border-accent/60 group w-full rounded-lg border p-3 text-left transition-colors"
                  >
                    <div className="flex items-center justify-between gap-3">
                      <span className="flex min-w-0 items-center gap-2">
                        <span className="text-muted font-mono text-xs">
                          #{i + 1}
                        </span>
                        <span className="font-display text-fg group-hover:text-accent truncate font-medium transition-colors">
                          {rec.name}
                        </span>
                      </span>
                      <span className="text-accent shrink-0 font-mono text-xs">
                        {Math.round(rec.score * 100)}%
                      </span>
                    </div>
                    <div className="bg-line mt-2 h-1 overflow-hidden rounded-full">
                      <div
                        className="bg-accent h-full rounded-full"
                        style={{ width: `${Math.round(rec.score * 100)}%` }}
                      />
                    </div>
                    <p className="text-muted mt-2 text-sm">{rec.reason}</p>
                  </button>
                </li>
              ))}
            </ol>
          )}

          {result.narration && (
            <div className="border-warm/30 bg-warm/5 rounded-lg border p-3">
              <div className="text-warm mb-1 flex items-center gap-1.5 font-mono text-[0.7rem] tracking-wide">
                <span aria-hidden>✦</span> narrated pick
              </div>
              <p className="text-fg/90 text-sm leading-relaxed">
                {result.narration}
              </p>
            </div>
          )}
        </div>
      )}
    </Panel>
  )
}
