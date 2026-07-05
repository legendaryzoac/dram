/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Base URL for the real REST API. Defaults to `/api`. */
  readonly VITE_API_BASE_URL?: string
  /** `'false'` forces the real fetch client; anything else keeps the mock. */
  readonly VITE_USE_MOCK?: string
  /** Cognito user pool id (real-auth mode). Optional in mock/dev. */
  readonly VITE_COGNITO_USER_POOL_ID?: string
  /** Cognito app client id (real-auth mode). Optional in mock/dev. */
  readonly VITE_COGNITO_CLIENT_ID?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
