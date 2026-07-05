import type {
  APIGatewayProxyEventV2WithJWTAuthorizer,
  APIGatewayProxyResultV2,
} from 'aws-lambda'
import {
  handleCreateBottle,
  handleDeleteBottle,
  handleGetBottle,
  handleListBottles,
  handleUpdateBottle,
} from './bottles'
import { json, noContent } from './http'
import { handleCreateNote } from './notes'
import { handleRecommendations } from './recommendations'

// The HTTP API's JWT authorizer (Cognito) gates every write route, so a request
// that reaches this Lambda on a write path is already authenticated. We treat a
// present `authorizer.jwt` as the auth signal and 401 otherwise — belt-and-
// suspenders in case a route is ever misconfigured as public.
function isAuthed(event: APIGatewayProxyEventV2WithJWTAuthorizer): boolean {
  return Boolean(event.requestContext.authorizer?.jwt?.claims?.sub)
}

export async function handler(
  event: APIGatewayProxyEventV2WithJWTAuthorizer,
): Promise<APIGatewayProxyResultV2> {
  const method = event.requestContext.http.method
  const origin = event.headers?.origin ?? event.headers?.Origin

  // CORS preflight: the HTTP API answers OPTIONS itself, but handle it too so
  // the function is correct if ever invoked directly.
  if (method === 'OPTIONS') return noContent(origin)

  // Prefer the routeKey the HTTP API resolved (e.g. "GET /bottles/{id}"), which
  // gives us path params for free; fall back to method+path for direct invokes.
  const routeKey = event.routeKey && event.routeKey !== '$default'
    ? event.routeKey
    : `${method} ${event.rawPath}`
  const params = event.pathParameters ?? {}
  const id = params.id

  try {
    // --- public reads ---
    if (routeKey === 'GET /health') return json(200, { ok: true }, origin)
    if (routeKey === 'GET /bottles') return await handleListBottles(origin)
    if (routeKey === 'GET /bottles/{id}' && id) {
      return await handleGetBottle(id, origin)
    }
    if (routeKey === 'GET /bottles/{id}/recommendations' && id) {
      return await handleRecommendations(id, origin)
    }

    // --- authed writes ---
    if (routeKey === 'POST /bottles') {
      if (!isAuthed(event)) return json(401, { error: 'unauthorized' }, origin)
      return await handleCreateBottle(event, origin)
    }
    if (routeKey === 'PUT /bottles/{id}' && id) {
      if (!isAuthed(event)) return json(401, { error: 'unauthorized' }, origin)
      return await handleUpdateBottle(id, event, origin)
    }
    if (routeKey === 'DELETE /bottles/{id}' && id) {
      if (!isAuthed(event)) return json(401, { error: 'unauthorized' }, origin)
      return await handleDeleteBottle(id, origin)
    }
    if (routeKey === 'POST /bottles/{id}/notes' && id) {
      if (!isAuthed(event)) return json(401, { error: 'unauthorized' }, origin)
      return await handleCreateNote(id, event, origin)
    }

    return json(404, { error: 'not found' }, origin)
  } catch (err) {
    console.error('unhandled error', routeKey, err)
    return json(500, { error: 'internal error' }, origin)
  }
}
