import type { APIGatewayProxyResultV2 } from 'aws-lambda'
import { narrate } from './bedrock'
import { json } from './http'
import { recommend, type CorpusBottle } from './recommender'
import { getBottleItem, listBottleItems, loadNotes } from './store'

/**
 * GET /bottles/{id}/recommendations -> RecommendationResult (public).
 * Loads the full corpus (bottles + notes) and runs the layered recommender.
 * Narration (Haiku) is wired in; it fails soft to the base ranking layer.
 */
export async function handleRecommendations(
  bottleId: string,
  origin?: string,
): Promise<APIGatewayProxyResultV2> {
  const target = await getBottleItem(bottleId)
  if (!target) return json(404, { error: 'bottle not found' }, origin)

  const items = await listBottleItems()
  const corpus: CorpusBottle[] = []
  for (const item of items) {
    const notes = await loadNotes(item.id)
    corpus.push({ item, notes })
  }

  const result = await recommend(bottleId, corpus, { narrate })
  return json(200, result, origin)
}
