/**
 * The API seam. One interface, two implementations:
 *
 *   - `makeRealApi()`  — real `fetch` against `VITE_API_BASE_URL` (default
 *                        `/api`), Cognito JWT Bearer on writes, public GETs.
 *   - `makeMockApi()`  — in-memory, seeded with ~12 bottles + notes + recs, so
 *                        every screen and every write flow is exercisable with
 *                        no deployed backend.
 *
 * `getApi()` picks between them from `import.meta.env.VITE_USE_MOCK`. The mock
 * is the default so `vite dev` / preview work fully offline; set
 * `VITE_USE_MOCK=false` to talk to the real backend.
 *
 * Writes need an auth token. In real mode that is a Cognito JWT; in mock mode
 * any truthy string works (the mock never verifies it) so the demo "signed in"
 * toggle can drive write flows without Cognito.
 */
import type {
  Bottle,
  BottleDetail,
  NewBottleInput,
  NewNoteInput,
  RecommendationResult,
  TastingNote,
} from './types'
import { makeMockApi } from './mockApi'

export interface DramApi {
  listBottles(): Promise<Bottle[]>
  getBottle(id: string): Promise<BottleDetail>
  createBottle(input: NewBottleInput, token: string): Promise<Bottle>
  updateBottle(
    id: string,
    input: Partial<NewBottleInput>,
    token: string,
  ): Promise<Bottle>
  deleteBottle(id: string, token: string): Promise<void>
  addNote(
    bottleId: string,
    input: NewNoteInput,
    token: string,
  ): Promise<TastingNote>
  getRecommendations(bottleId: string): Promise<RecommendationResult>
  health(): Promise<{ ok: true }>
}

export const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? '/api'

/** Mock unless explicitly disabled — keeps preview working with no backend. */
export const USE_MOCK = import.meta.env.VITE_USE_MOCK !== 'false'

/** Raised for any non-2xx response so screens can show a message. */
export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message)
    this.name = 'ApiError'
  }
}

async function parse<T>(res: Response): Promise<T> {
  if (!res.ok) {
    let detail = res.statusText
    try {
      const body = (await res.json()) as { message?: string; error?: string }
      detail = body.message ?? body.error ?? detail
    } catch {
      /* non-JSON error body */
    }
    throw new ApiError(res.status, detail)
  }
  return res.json() as Promise<T>
}

function authHeaders(token: string, json: boolean): HeadersInit {
  const h: Record<string, string> = { Authorization: `Bearer ${token}` }
  if (json) h['content-type'] = 'application/json'
  return h
}

export function makeRealApi(baseUrl = API_BASE_URL): DramApi {
  const url = (path: string) => `${baseUrl}${path}`
  return {
    async listBottles() {
      return parse<Bottle[]>(await fetch(url('/bottles')))
    },
    async getBottle(id) {
      return parse<BottleDetail>(await fetch(url(`/bottles/${id}`)))
    },
    async createBottle(input, token) {
      const res = await fetch(url('/bottles'), {
        method: 'POST',
        headers: authHeaders(token, true),
        body: JSON.stringify(input),
      })
      return parse<Bottle>(res)
    },
    async updateBottle(id, input, token) {
      const res = await fetch(url(`/bottles/${id}`), {
        method: 'PUT',
        headers: authHeaders(token, true),
        body: JSON.stringify(input),
      })
      return parse<Bottle>(res)
    },
    async deleteBottle(id, token) {
      const res = await fetch(url(`/bottles/${id}`), {
        method: 'DELETE',
        headers: authHeaders(token, false),
      })
      if (!res.ok && res.status !== 204) {
        throw new ApiError(res.status, res.statusText)
      }
    },
    async addNote(bottleId, input, token) {
      const res = await fetch(url(`/bottles/${bottleId}/notes`), {
        method: 'POST',
        headers: authHeaders(token, true),
        body: JSON.stringify(input),
      })
      return parse<TastingNote>(res)
    },
    async getRecommendations(bottleId) {
      return parse<RecommendationResult>(
        await fetch(url(`/bottles/${bottleId}/recommendations`)),
      )
    },
    async health() {
      return parse<{ ok: true }>(await fetch(url('/health')))
    },
  }
}

let cached: DramApi | null = null

/** The app-wide client. Mock in dev/preview, real fetch when disabled. */
export function getApi(): DramApi {
  cached ??= USE_MOCK ? makeMockApi() : makeRealApi()
  return cached
}
