import type { APIGatewayProxyResultV2 } from 'aws-lambda'

// CORS: the browser app is served from dram.zackwithers.com; localhost covers
// the Vite dev server. The HTTP API's own CORS config (in the CDK stack) also
// sets these — mirroring them here keeps direct/function-url responses correct.
const ALLOWED_ORIGINS = new Set([
  'https://dram.zackwithers.com',
  'http://localhost:5173',
  'http://localhost:4173',
])

export function corsHeaders(origin: string | undefined): Record<string, string> {
  const allow =
    origin && ALLOWED_ORIGINS.has(origin)
      ? origin
      : 'https://dram.zackwithers.com'
  return {
    'access-control-allow-origin': allow,
    'access-control-allow-headers': 'authorization,content-type',
    'access-control-allow-methods': 'GET,POST,PUT,DELETE,OPTIONS',
    vary: 'origin',
  }
}

export function json(
  statusCode: number,
  body: unknown,
  origin?: string,
): APIGatewayProxyResultV2 {
  return {
    statusCode,
    headers: { 'content-type': 'application/json', ...corsHeaders(origin) },
    body: JSON.stringify(body),
  }
}

/** 204 No Content — no body (DELETE success). */
export function noContent(origin?: string): APIGatewayProxyResultV2 {
  return { statusCode: 204, headers: corsHeaders(origin), body: '' }
}
