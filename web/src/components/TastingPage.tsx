/**
 * Group tasting (route `#/tasting`, `#/tasting/:code`) — not in the nav; you
 * get here from the link a host shares.
 *
 *   - Host (signed in): open a tasting, get a code good for 8 hours, copy the
 *     share link, see how many notes have come in, end it early.
 *   - Guest (no account): type the code (or open the link) and a name, then
 *     log tasting notes against the bottles on the shelf.
 *
 * The guest screen is notes only. It never opens a bottle's detail page, so
 * a guest makes no recommendation or pairing calls; their notes still land on
 * the bottles like anyone's.
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import type { Bottle, NewNoteInput, Tasting } from '../lib/types'
import { TASTING_LIMITS, TASTING_TTL_HOURS, formatCode, onShelf } from '../lib/types'
import { ApiError, getApi } from '../lib/api'
import {
  clearGuestSession,
  loadGuestSession,
  saveGuestSession,
  shareLink,
  timeLeft,
  type GuestSession,
} from '../lib/tasting'
import { navigate, href } from '../lib/router'
import { useAuth } from './AuthContext'
import NoteForm from './NoteForm'
import {
  Field,
  Meta,
  Notice,
  Panel,
  SectionTitle,
  Spinner,
  buttonClass,
  dangerButtonClass,
  ghostButtonClass,
  inputClass,
} from './ui'

interface Props {
  /** From `#/tasting/:code` — prefills the join form. */
  initialCode?: string
  onRequireAuth: () => void
}

/** Re-render every 30s so countdowns stay honest. */
function useNow(intervalMs = 30_000): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), intervalMs)
    return () => clearInterval(t)
  }, [intervalMs])
  return now
}

export default function TastingPage({ initialCode, onRequireAuth }: Props) {
  const { token } = useAuth()
  const [session, setSession] = useState<GuestSession | null>(() => {
    const s = loadGuestSession()
    // A link for a different tasting wins over a stale session.
    if (s && initialCode && formatCode(initialCode) !== formatCode(s.code)) return null
    return s
  })
  const [endedNotice, setEndedNotice] = useState<string | null>(null)

  const leave = useCallback((why?: string) => {
    clearGuestSession()
    setSession(null)
    setEndedNotice(why ?? null)
  }, [])

  const update = useCallback((s: GuestSession) => {
    saveGuestSession(s)
    setSession(s)
  }, [])

  return (
    <div className="flex flex-col gap-6">
      <header>
        <p className="text-muted font-mono text-xs">dram ~ group tasting</p>
        <h1 className="font-display text-fg mt-1 text-2xl font-semibold">
          {session ? session.invite.label : 'Group tasting'}
        </h1>
      </header>

      {endedNotice && <Notice tone="soft">{endedNotice}</Notice>}

      {session ? (
        <GuestView session={session} onUpdate={update} onLeave={leave} />
      ) : (
        <>
          {token && <HostPanel token={token} />}
          <JoinPanel
            initialCode={initialCode}
            onJoined={(s) => {
              setEndedNotice(null)
              update(s)
            }}
          />
          {!token && (
            <p className="text-muted font-mono text-xs">
              Hosting?{' '}
              <button onClick={onRequireAuth} className="text-accent hover:underline">
                Sign in
              </button>{' '}
              to open a tasting and get a code.
            </p>
          )}
        </>
      )}
    </div>
  )
}

// ---- guest: join ----

function JoinPanel({
  initialCode,
  onJoined,
}: {
  initialCode?: string
  onJoined: (s: GuestSession) => void
}) {
  const [code, setCode] = useState(initialCode ? formatCode(initialCode) : '')
  const [taster, setTaster] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function join(e: React.FormEvent) {
    e.preventDefault()
    const name = taster.trim()
    if (!code.trim() || !name) return
    setBusy(true)
    setError(null)
    try {
      const invite = await getApi().getTasting(code)
      onJoined({ code: formatCode(code), taster: name, invite, logged: [] })
    } catch (err) {
      setError(
        err instanceof ApiError && err.status === 404
          ? 'No tasting with that code — check it with your host.'
          : err instanceof ApiError && err.status === 410
            ? 'That tasting has ended.'
            : err instanceof Error
              ? err.message
              : 'Could not join',
      )
      setBusy(false)
    }
  }

  return (
    <Panel>
      <SectionTitle hint="no account needed">Join a tasting</SectionTitle>
      <form onSubmit={join} className="flex flex-col gap-4 sm:max-w-sm">
        <Field label="Code from your host">
          <input
            className={`${inputClass} font-mono text-lg tracking-[0.2em] uppercase`}
            value={code}
            onChange={(e) => setCode(e.target.value)}
            placeholder="XXXX-XXXX"
            autoCapitalize="characters"
            autoComplete="off"
            spellCheck={false}
            maxLength={12}
          />
        </Field>
        <Field label="Your name">
          <input
            className={inputClass}
            value={taster}
            onChange={(e) => setTaster(e.target.value)}
            placeholder="Sam"
            maxLength={TASTING_LIMITS.taster}
            autoComplete="given-name"
          />
        </Field>
        {error && <Notice>{error}</Notice>}
        <button className={buttonClass} disabled={busy || !code.trim() || !taster.trim()}>
          {busy ? 'Checking…' : 'Join'}
        </button>
      </form>
    </Panel>
  )
}

// ---- guest: log notes ----

function GuestView({
  session,
  onUpdate,
  onLeave,
}: {
  session: GuestSession
  onUpdate: (s: GuestSession) => void
  onLeave: (why?: string) => void
}) {
  const now = useNow()
  const [bottles, setBottles] = useState<Bottle[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState<string | null>(null)

  const expired = Date.parse(session.invite.expiresAt) <= now
  useEffect(() => {
    if (expired) onLeave('That tasting has ended — thanks for pouring along.')
  }, [expired, onLeave])

  useEffect(() => {
    let live = true
    getApi()
      .listBottles()
      .then((list) => live && setBottles(list.filter(onShelf)))
      .catch((e: Error) => live && setError(e.message))
    return () => {
      live = false
    }
  }, [])

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase()
    const list = (bottles ?? []).slice().sort((a, b) => a.name.localeCompare(b.name))
    if (!q) return list
    return list.filter((b) =>
      [b.name, b.producer, b.type, b.region].some((f) => f.toLowerCase().includes(q)),
    )
  }, [bottles, query])

  async function submit(bottleId: string, input: NewNoteInput) {
    try {
      await getApi().addTastingNote(session.code, bottleId, {
        ...input,
        taster: session.taster,
      })
    } catch (err) {
      if (err instanceof ApiError && (err.status === 410 || err.status === 404)) {
        onLeave('Your host has ended this tasting — the notes you saved are kept.')
      }
      throw err
    }
  }

  return (
    <>
      <Panel className="flex flex-wrap items-center justify-between gap-3">
        <Meta
          items={[
            { text: session.taster, tone: 'lead' },
            `code ${formatCode(session.code)}`,
            `ends in ${timeLeft(session.invite.expiresAt, now)}`,
            session.logged.length > 0 && `${session.logged.length} logged`,
          ]}
        />
        <button className={ghostButtonClass} onClick={() => onLeave()}>
          Leave
        </button>
      </Panel>

      <Panel>
        <SectionTitle hint="tap a bottle to log what you taste">On the shelf</SectionTitle>
        <input
          className={`${inputClass} mb-4`}
          placeholder="Find a bottle…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        {error && <Notice>{error}</Notice>}
        {!bottles && !error && <Spinner label="Loading the shelf…" />}
        {bottles && shown.length === 0 && (
          <p className="text-muted text-sm">Nothing on the shelf matches.</p>
        )}
        <ul className="flex flex-col gap-3">
          {shown.map((b) => {
            const logged = session.logged.includes(b.id)
            return (
              <li key={b.id} className="border-line bg-panel-2/50 rounded-lg border">
                <button
                  className="flex min-h-[44px] w-full items-center justify-between gap-3 p-3 text-left"
                  onClick={() => setOpen(open === b.id ? null : b.id)}
                  aria-expanded={open === b.id}
                >
                  <span className="min-w-0">
                    <span className="font-display text-fg block truncate font-medium">
                      {b.name}
                    </span>
                    <Meta items={[b.type, b.region, b.abv > 0 && `${b.abv}% ABV`]} />
                  </span>
                  <span className="text-muted shrink-0 font-mono text-xs">
                    {logged ? <span className="text-accent">✓ logged</span> : open === b.id ? 'close' : 'log'}
                  </span>
                </button>
                {open === b.id && (
                  <div className="border-line border-t p-3">
                    <NoteForm
                      bottleId={b.id}
                      bottleType={b.type}
                      submitNote={(input) => submit(b.id, input)}
                      onSaved={() => {
                        setOpen(null)
                        if (!logged) {
                          onUpdate({ ...session, logged: [...session.logged, b.id] })
                        }
                      }}
                      onCancel={() => setOpen(null)}
                    />
                  </div>
                )}
              </li>
            )
          })}
        </ul>
      </Panel>
    </>
  )
}

// ---- host ----

function HostPanel({ token }: { token: string }) {
  const now = useNow()
  const [tastings, setTastings] = useState<Tasting[] | null>(null)
  const [label, setLabel] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState<string | null>(null)
  const [reload, setReload] = useState(0)

  useEffect(() => {
    let live = true
    getApi()
      .listTastings(token)
      .then((list) => live && setTastings(list))
      .catch((e: Error) => live && setError(e.message))
    return () => {
      live = false
    }
  }, [token, reload])

  async function start(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      await getApi().createTasting({ label: label.trim() || undefined }, token)
      setLabel('')
      setReload((r) => r + 1)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not open a tasting')
    } finally {
      setBusy(false)
    }
  }

  async function end(code: string) {
    setError(null)
    try {
      await getApi().endTasting(code, token)
      setReload((r) => r + 1)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not end it')
    }
  }

  async function copy(code: string) {
    const link = shareLink(code)
    try {
      await navigator.clipboard.writeText(link)
      setCopied(code)
      setTimeout(() => setCopied((c) => (c === code ? null : c)), 2000)
    } catch {
      window.prompt('Copy this link', link)
    }
  }

  // An expired tasting can still read "live" until the next list; go by the clock.
  const isLive = (t: Tasting) => t.status === 'live' && Date.parse(t.expiresAt) > now
  const live = (tastings ?? []).filter(isLive)
  const past = (tastings ?? []).filter((t) => !isLive(t))

  return (
    <Panel>
      <SectionTitle hint={`codes last ${TASTING_TTL_HOURS} hours`}>Host a tasting</SectionTitle>
      <form onSubmit={start} className="flex flex-col gap-3 sm:flex-row sm:items-end">
        <div className="flex-1">
          <Field label="Name it (optional)">
            <input
              className={inputClass}
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="Islay night"
              maxLength={TASTING_LIMITS.label}
            />
          </Field>
        </div>
        <button className={buttonClass} disabled={busy}>
          {busy ? 'Opening…' : 'Start a tasting'}
        </button>
      </form>

      {error && (
        <div className="mt-3">
          <Notice>{error}</Notice>
        </div>
      )}
      {!tastings && !error && <Spinner label="Loading your tastings…" />}

      {live.length > 0 && (
        <ul className="mt-5 flex flex-col gap-3">
          {live.map((t) => (
            <li key={t.id} className="border-accent/40 bg-accent/5 rounded-lg border p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-fg font-medium">{t.label}</p>
                  <p className="text-accent mt-1 font-mono text-3xl tracking-[0.15em] select-all">
                    {formatCode(t.code)}
                  </p>
                  <Meta
                    className="mt-1"
                    items={[
                      `ends in ${timeLeft(t.expiresAt, now)}`,
                      `${t.noteCount} ${t.noteCount === 1 ? 'note' : 'notes'}`,
                    ]}
                  />
                </div>
                <div className="flex gap-2">
                  <button className={ghostButtonClass} onClick={() => copy(t.code)}>
                    {copied === t.code ? 'Copied' : 'Copy link'}
                  </button>
                  <button className={dangerButtonClass} onClick={() => end(t.code)}>
                    End
                  </button>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}

      {past.length > 0 && (
        <div className="mt-5">
          <p className="text-muted mb-2 font-mono text-[0.7rem] uppercase tracking-wider">
            Earlier
          </p>
          <ul className="flex flex-col gap-1">
            {past.map((t) => (
              <li key={t.id}>
                <Meta
                  items={[
                    t.label,
                    t.endedAt ? 'ended early' : 'expired',
                    `${t.noteCount} ${t.noteCount === 1 ? 'note' : 'notes'}`,
                    new Date(t.createdAt).toLocaleDateString(),
                  ]}
                />
              </li>
            ))}
          </ul>
        </div>
      )}

      <p className="text-muted mt-4 text-xs">
        Guests log notes on bottles on the shelf, under their own name. They can’t
        edit bottles or notes, and get no recommendations or pairing.{' '}
        <button onClick={() => navigate(href.list())} className="text-accent hover:underline">
          Back to the cabinet
        </button>
      </p>
    </Panel>
  )
}
