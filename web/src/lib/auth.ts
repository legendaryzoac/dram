/**
 * Cognito auth, mirroring fit/web's approach — a user pool, email+password
 * sign-in, session restore, and sign-out. Pool/client ids come from Vite env
 * (`VITE_COGNITO_USER_POOL_ID` / `VITE_COGNITO_CLIENT_ID`) rather than being
 * hard-coded, since dram's pool is provisioned by its own CDK stack.
 *
 * Writes need a JWT. In mock/dev mode we never construct a real pool — the
 * App uses a demo "signed in" toggle that hands the mock client a throwaway
 * token — so an unconfigured pool id is fine and simply yields no session.
 */
import {
  AuthenticationDetails,
  CognitoUser,
  CognitoUserPool,
} from 'amazon-cognito-identity-js'
import type { CognitoUserSession } from 'amazon-cognito-identity-js'

const USER_POOL_ID = import.meta.env.VITE_COGNITO_USER_POOL_ID ?? ''
const CLIENT_ID = import.meta.env.VITE_COGNITO_CLIENT_ID ?? ''

export const AUTH_CONFIGURED = Boolean(USER_POOL_ID && CLIENT_ID)

let cachedPool: CognitoUserPool | null = null
function pool(): CognitoUserPool {
  cachedPool ??= new CognitoUserPool({
    UserPoolId: USER_POOL_ID,
    ClientId: CLIENT_ID,
  })
  return cachedPool
}

export type SignInResult =
  | { kind: 'success'; session: CognitoUserSession }
  | { kind: 'new-password-required'; user: CognitoUser }

export function signIn(email: string, password: string): Promise<SignInResult> {
  const user = new CognitoUser({ Username: email, Pool: pool() })
  return new Promise((resolve, reject) => {
    user.authenticateUser(
      new AuthenticationDetails({ Username: email, Password: password }),
      {
        onSuccess: (session) => resolve({ kind: 'success', session }),
        onFailure: reject,
        newPasswordRequired: () =>
          resolve({ kind: 'new-password-required', user }),
      },
    )
  })
}

export function completeNewPassword(
  user: CognitoUser,
  newPassword: string,
): Promise<CognitoUserSession> {
  return new Promise((resolve, reject) => {
    user.completeNewPasswordChallenge(
      newPassword,
      {},
      { onSuccess: resolve, onFailure: reject },
    )
  })
}

export function restoreSession(): Promise<CognitoUserSession | null> {
  if (!AUTH_CONFIGURED) return Promise.resolve(null)
  let user: CognitoUser | null
  try {
    user = pool().getCurrentUser()
  } catch {
    return Promise.resolve(null)
  }
  if (!user) return Promise.resolve(null)
  return new Promise((resolve) => {
    user.getSession((err: Error | null, session: CognitoUserSession | null) => {
      resolve(err || !session?.isValid() ? null : session)
    })
  })
}

export function signOut(): void {
  if (!AUTH_CONFIGURED) return
  pool().getCurrentUser()?.signOut()
}
