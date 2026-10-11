/**
 * "Bottles like this" / "Coffees like this" — renders a RecommendationResult
 * end to end:
 *
 *   - a `basis` badge translating the recommender layer into plain language
 *     ("matched on metadata" / "matched on tasting notes" / "AI-picked"),
 *   - the ranked same-family recommendations with score bar and `reason`,
 *   - an "Across the aisle" section bridging coffee ↔ the cabinet whenever
 *     the other family has matches (`crossFamily`),
 *   - the `narration` prose when the narrated layer produced it (bottle
 *     names in it link to their pages),
 *   - a subtle banner when the result is `degraded` (a lower layer answered).
 */
import { useEffect, useState } from 'react'
import type {
  Recommendation,
  RecommendationBasis,
  RecommendationResult,
} from '../lib/types'
import { isCoffee } from '../lib/types'
import { getApi } from '../lib/api'
import { href, navigate } from '../lib/router'
import Narration from './Narration'
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
      'Ranked by what these actually taste like, from your written tasting notes.',
  },
  narrated: {
    label: 'AI-picked',
    className: 'border-warm/40 bg-warm/10 text-warm',
    blurb: 'Reasoned over your tasting history and explained below.',
  },
}

export default function RecommendationsPanel({
  bottleId,
  bottleType,
}: {
  bottleId: string
  /** The target's beverage type — drives coffee-vs-cabinet copy. */
  bottleType: string
}) {
  const [result, setResult] = useState<RecommendationResult | null>(null)
  const [error, setError] = useState<string | null>(null)

  // No reset-in-effect: the panel is remounted (keyed) whenever the target
  // bottle or its notes change, so mount state is already blank.
  useEffect(() => {
    let live = true
    getApi()
      .getRecommendations(bottleId)
      .then((r) => {
        if (live) {
          setResult(r)
          setError(null)
        }
      })
      .catch((e) => live && setError(e.message))
    return () => {
      live = false
    }
  }, [bottleId])

  const coffee = isCoffee(bottleType)
  // Tolerate a not-yet-redeployed API that predates the crossFamily field.
  const crossFamily = result?.crossFamily ?? []

  return (
    <Panel>
      <SectionTitle hint="recommender">
        {coffee ? 'Coffees like this' : 'Bottles like this'}
      </SectionTitle>

      {error && <ErrorNote>Couldn’t load recommendations: {error}</ErrorNote>}
      {!result && !error && (
        <Spinner label={coffee ? 'Scoring the shelf…' : 'Scoring the cabinet…'} />
      )}

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
              {coffee
                ? 'Nothing close enough to recommend yet — log a few more coffees.'
                : 'Nothing close enough to recommend yet — log a few more bottles.'}
            </p>
          ) : (
            <ol className="flex flex-col gap-2.5">
              {result.recommendations.map((rec, i) => (
                <li key={rec.bottleId}>
                  <RecRow rec={rec} rank={i + 1} />
                </li>
              ))}
            </ol>
          )}

          {crossFamily.length > 0 && (
            <div className="border-line border-t pt-4">
              <SectionTitle
                hint={coffee ? 'from the cabinet' : 'from the coffee bar'}
              >
                Across the aisle
              </SectionTitle>
              <p className="text-muted -mt-2 mb-3 text-xs">
                {coffee
                  ? 'Pours whose tasting profile echoes this coffee.'
                  : 'Coffees whose tasting profile echoes this pour.'}
              </p>
              <ol className="flex flex-col gap-2.5">
                {crossFamily.map((rec, i) => (
                  <li key={rec.bottleId}>
                    <RecRow rec={rec} rank={i + 1} />
                  </li>
                ))}
              </ol>
            </div>
          )}

          {result.narration && (
            <div className="border-warm/30 bg-warm/5 rounded-lg border p-3">
              <div className="text-warm mb-1 flex items-center gap-1.5 font-mono text-[0.7rem] tracking-wide">
                <span aria-hidden>✦</span> narrated pick
              </div>
              <p className="text-fg/90 text-sm leading-relaxed">
                <Narration
                  text={result.narration}
                  links={[...result.recommendations, ...crossFamily].map(
                    (r) => ({ name: r.name, id: r.bottleId }),
                  )}
                />
              </p>
            </div>
          )}
        </div>
      )}
    </Panel>
  )
}

function RecRow({ rec, rank }: { rec: Recommendation; rank: number }) {
  return (
    <button
      onClick={() => navigate(href.detail(rec.bottleId))}
      className="border-line bg-panel-2/50 hover:border-accent/60 group w-full rounded-lg border p-3 text-left transition-colors"
    >
      <div className="flex items-center justify-between gap-3">
        <span className="flex min-w-0 items-center gap-2">
          <span className="text-muted font-mono text-xs">#{rank}</span>
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
  )
}
