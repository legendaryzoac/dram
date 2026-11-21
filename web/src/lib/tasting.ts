/**
 * Group-tasting guest session, kept in localStorage so a guest who reloads
 * (or locks their phone mid-pour) is still in. It holds only what the guest
 * typed and what the code unlocked; it's dropped once the tasting expires,
 * or the moment the API answers 404/410 for it.
 */
import type { TastingInvite } from './types'

export interface GuestSession {
  code: string
  taster: string
  invite: TastingInvite
  /** Bottle ids this guest has logged during the tasting. */
  logged: string[]
}

const KEY = 'dram.tasting.guest'

export function loadGuestSession(now = Date.now()): GuestSession | null {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return null
    const s = JSON.parse(raw) as GuestSession
    if (!s?.code || !s.invite?.expiresAt) return null
    if (Date.parse(s.invite.expiresAt) <= now) {
      clearGuestSession()
      return null
    }
    return { ...s, logged: Array.isArray(s.logged) ? s.logged : [] }
  } catch {
    return null
  }
}

export function saveGuestSession(s: GuestSession): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(s))
  } catch {
    /* private mode / storage blocked: the session just won't survive a reload */
  }
}

export function clearGuestSession(): void {
  try {
    localStorage.removeItem(KEY)
  } catch {
    /* ignore */
  }
}

/** "7h 59m" / "12m" / "under a minute" / "ended". */
export function timeLeft(expiresAt: string, now = Date.now()): string {
  const ms = Date.parse(expiresAt) - now
  if (ms <= 0) return 'ended'
  const mins = Math.floor(ms / 60_000)
  if (mins < 1) return 'under a minute'
  const h = Math.floor(mins / 60)
  const m = mins % 60
  return h > 0 ? `${h}h ${m}m` : `${m}m`
}

/** The link a host shares: this app, opened on the tasting with the code in. */
export function shareLink(code: string, loc: Pick<Location, 'origin' | 'pathname'> = window.location): string {
  return `${loc.origin}${loc.pathname}#/tasting/${code}`
}
