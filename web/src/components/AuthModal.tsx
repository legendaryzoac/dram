/**
 * Sign-in modal. Real mode drives the Cognito email/password + new-password
 * flow (mirrors fit/web). In mock/dev mode it also offers a one-tap demo
 * "signed in" toggle so every write flow is exercisable in preview without a
 * configured Cognito pool.
 */
import { useState } from 'react'
import type {
  CognitoUser,
  CognitoUserSession,
} from 'amazon-cognito-identity-js'
import { completeNewPassword, signIn, AUTH_CONFIGURED } from '../lib/auth'
import { USE_MOCK } from '../lib/api'
import { useAuth } from './AuthContext'
import { buttonClass, ghostButtonClass, inputClass, Notice } from './ui'

type Phase =
  | { phase: 'login' }
  | { phase: 'new-password'; user: CognitoUser }

export default function AuthModal({ onClose }: { onClose: () => void }) {
  const { signInWithSession, enterDemo } = useAuth()
  const [phase, setPhase] = useState<Phase>({ phase: 'login' })
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  function done(session: CognitoUserSession) {
    signInWithSession(session)
    onClose()
  }

  async function submitLogin(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      const result = await signIn(email.trim(), password)
      if (result.kind === 'success') done(result.session)
      else setPhase({ phase: 'new-password', user: result.user })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Sign-in failed')
    } finally {
      setBusy(false)
    }
  }

  async function submitNewPassword(e: React.FormEvent, user: CognitoUser) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      done(await completeNewPassword(user, password))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not set password')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="border-line bg-panel w-full max-w-sm rounded-xl border p-6 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="font-display text-fg text-lg font-semibold">Sign in</h2>
          <button
            onClick={onClose}
            className="text-muted hover:text-fg text-xl leading-none"
            aria-label="Close"
          >
            ×
          </button>
        </div>

        {phase.phase === 'login' ? (
          <form onSubmit={submitLogin} className="flex flex-col gap-3">
            <p className="text-muted text-sm">
              Writing needs an account — reads are open to everyone.
            </p>
            <input
              className={inputClass}
              type="email"
              placeholder="email"
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              disabled={!AUTH_CONFIGURED}
              required
            />
            <input
              className={inputClass}
              type="password"
              placeholder="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              disabled={!AUTH_CONFIGURED}
              required
            />
            {error && <Notice>{error}</Notice>}
            {!AUTH_CONFIGURED && (
              <p className="text-muted font-mono text-xs">
                Cognito isn’t configured in this build — use the demo below.
              </p>
            )}
            <button
              className={`${buttonClass} w-full`}
              disabled={busy || !AUTH_CONFIGURED}
            >
              {busy ? 'Signing in…' : 'Sign in'}
            </button>

            {USE_MOCK && (
              <>
                <div className="text-muted my-1 flex items-center gap-3 text-xs">
                  <span className="bg-line h-px flex-1" />
                  or
                  <span className="bg-line h-px flex-1" />
                </div>
                <button
                  type="button"
                  className={`${ghostButtonClass} w-full`}
                  onClick={() => {
                    enterDemo()
                    onClose()
                  }}
                >
                  Continue in demo mode →
                </button>
                <p className="text-muted text-center font-mono text-[0.7rem]">
                  Demo writes stay in your browser only.
                </p>
              </>
            )}
          </form>
        ) : (
          <form
            onSubmit={(e) => submitNewPassword(e, phase.user)}
            className="flex flex-col gap-3"
          >
            <p className="text-muted text-sm">
              Choose a password to finish setting up your account (12+
              characters).
            </p>
            <input
              className={inputClass}
              type="password"
              placeholder="new password"
              autoComplete="new-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              minLength={12}
              required
            />
            {error && <Notice>{error}</Notice>}
            <button className={`${buttonClass} w-full`} disabled={busy}>
              {busy ? 'Saving…' : 'Set password'}
            </button>
          </form>
        )}
      </div>
    </div>
  )
}
