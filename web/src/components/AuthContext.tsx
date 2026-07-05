/**
 * App-wide auth/session state. Two ways to be "signed in":
 *
 *   - real  — a Cognito session; `token` is the JWT sent on writes.
 *   - demo  — mock/dev only; a throwaway token that the mock accepts but never
 *             verifies, so write flows are demoable in preview without Cognito.
 *
 * Reads never need this — GETs are public. Only the write UIs gate on `token`.
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import type { CognitoUserSession } from 'amazon-cognito-identity-js'
import { restoreSession, signOut as cognitoSignOut } from '../lib/auth'
import { USE_MOCK } from '../lib/api'

interface AuthValue {
  /** Non-null when signed in (real or demo). Sent as Bearer on writes. */
  token: string | null
  email: string | null
  mode: 'signed-out' | 'real' | 'demo'
  loading: boolean
  signInWithSession(session: CognitoUserSession): void
  /** Mock-only: flip on the demo "signed in" state. */
  enterDemo(): void
  signOut(): void
}

const AuthContext = createContext<AuthValue | null>(null)

const DEMO_TOKEN = 'demo-token'

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<CognitoUserSession | null>(null)
  const [demo, setDemo] = useState(false)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    restoreSession().then((s) => {
      setSession(s)
      setLoading(false)
    })
  }, [])

  const signInWithSession = useCallback((s: CognitoUserSession) => {
    setDemo(false)
    setSession(s)
  }, [])

  const enterDemo = useCallback(() => {
    if (USE_MOCK) setDemo(true)
  }, [])

  const signOut = useCallback(() => {
    cognitoSignOut()
    setSession(null)
    setDemo(false)
  }, [])

  const value = useMemo<AuthValue>(() => {
    if (session) {
      return {
        token: session.getAccessToken().getJwtToken(),
        email: (session.getIdToken().payload.email as string) ?? null,
        mode: 'real',
        loading,
        signInWithSession,
        enterDemo,
        signOut,
      }
    }
    if (demo) {
      return {
        token: DEMO_TOKEN,
        email: 'demo',
        mode: 'demo',
        loading,
        signInWithSession,
        enterDemo,
        signOut,
      }
    }
    return {
      token: null,
      email: null,
      mode: 'signed-out',
      loading,
      signInWithSession,
      enterDemo,
      signOut,
    }
  }, [session, demo, loading, signInWithSession, enterDemo, signOut])

  return <AuthContext value={value}>{children}</AuthContext>
}

export function useAuth(): AuthValue {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within AuthProvider')
  return ctx
}
