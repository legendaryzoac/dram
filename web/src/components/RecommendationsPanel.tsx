/**
 * "Bottles like this" / "Coffees like this" — renders a RecommendationResult
 * end to end:
 *
 *   - the recommender layer as the panel's hint, in plain language ("matched
 *     on tasting notes"), with a one-line blurb under the title,
 *   - the ranked same-family recommendations as Rows (score bar + `reason`),
 *   - an "Across the aisle" section bridging coffee ↔ the cabinet whenever
 *     the other family has matches (`crossFamily`),
 *   - the `narration` prose when the narrated layer produced it (bottle
 *     names in it link to their pages),
 *   - a soft notice when the result is `degraded` (a lower layer answered).
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
import Narration, { NarrationBox } from './Narration'
import { Notice, Panel, Row, SectionTitle, Spinner } from './ui'

/** Plain-language hint + blurb for each recommender basis. */
const BASIS_META: Record<RecommendationBasis, { label: string; blurb: string }> = {
  structured: {
    label: 'matched on metadata',
    blurb: 'Ranked by structured similarity — region, type, and flavor tags.',
  },
  text: {
    label: 'matched on tasting notes',
    blurb:
      'Ranked by what these actually taste like, from your written tasting notes.',
  },
  narrated: {
    label: 'narrated',
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
  const basis = result ? BASIS_META[result.basis] : null

  return (
    <Panel>
      <SectionTitle hint={basis?.label ?? 'recommender'}>
        {coffee ? 'Coffees like this' : 'Bottles like this'}
      </SectionTitle>
      {basis && <p className="text-muted -mt-2 mb-3 text-xs">{basis.blurb}</p>}

      {error && <Notice>Couldn’t load recommendations: {error}</Notice>}
      {!result && !error && (
        <Spinner label={coffee ? 'Scoring the shelf…' : 'Scoring the cabinet…'} />
      )}

      {result && (
        <div className="flex flex-col gap-4">
          {result.degraded && (
            <Notice tone="soft">
              Heads up — the richer recommender was unavailable, so this fell back
              to a simpler match.
            </Notice>
          )}

          {result.recommendations.length === 0 ? (
            <p className="text-muted text-sm">
              {coffee
                ? 'Nothing close enough to recommend yet — log a few more coffees.'
                : 'Nothing close enough to recommend yet — log a few more bottles.'}
            </p>
          ) : (
            <RecList recs={result.recommendations} />
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
              <RecList recs={crossFamily} />
            </div>
          )}

          {result.narration && (
            <NarrationBox label="narrated pick">
              <p className="text-fg/90 text-sm leading-relaxed">
                <Narration
                  text={result.narration}
                  links={[...result.recommendations, ...crossFamily].map(
                    (r) => ({ name: r.name, id: r.bottleId }),
                  )}
                />
              </p>
            </NarrationBox>
          )}
        </div>
      )}
    </Panel>
  )
}

function RecList({ recs }: { recs: Recommendation[] }) {
  return (
    <ol className="flex flex-col gap-2.5">
      {recs.map((rec, i) => (
        <li key={rec.bottleId}>
          <Row
            rank={i + 1}
            name={rec.name}
            score={rec.score}
            reason={rec.reason}
            onOpen={() => navigate(href.detail(rec.bottleId))}
          />
        </li>
      ))}
    </ol>
  )
}
