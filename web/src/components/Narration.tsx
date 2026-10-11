/**
 * Narration prose from the Haiku layer, rendered with two courtesies:
 *   - bold / italic asterisk markers become real emphasis (the model is told
 *     "no markdown" but sometimes emits it anyway), and
 *   - any bottle name from `links` becomes a tap target to that bottle's page,
 *     so "pour the Lagavulin 16" is one tap from the cabinet.
 * Pure over its props; the inline tokenizer lives in lib/inlineMarkdown.
 */
import type { ReactNode } from 'react'
import { tokenizeInline } from '../lib/inlineMarkdown'
import { href, navigate } from '../lib/router'

export interface NarrationLink {
  name: string
  id: string
}

/** Names shorter than this are too likely to collide with ordinary words. */
const MIN_LINK_NAME = 4

export default function Narration({
  text,
  links = [],
}: {
  text: string
  links?: NarrationLink[]
}) {
  const matcher = buildMatcher(links)
  return (
    <>
      {tokenizeInline(text).map((t, i) =>
        t.kind === 'bold' ? (
          <strong key={i} className="text-fg font-semibold">
            {linkify(t.text, matcher)}
          </strong>
        ) : t.kind === 'italic' ? (
          <em key={i}>{linkify(t.text, matcher)}</em>
        ) : (
          <span key={i}>{linkify(t.text, matcher)}</span>
        ),
      )}
    </>
  )
}

interface Matcher {
  re: RegExp
  byName: Map<string, string>
}

function buildMatcher(links: NarrationLink[]): Matcher | null {
  const usable = links.filter((l) => l.name.trim().length >= MIN_LINK_NAME)
  if (usable.length === 0) return null
  // Longest first so "Lagavulin 16 Distillers Edition" wins over "Lagavulin 16".
  const names = [...new Set(usable.map((l) => l.name.trim()))].sort(
    (a, b) => b.length - a.length,
  )
  const byName = new Map(
    usable.map((l) => [l.name.trim().toLowerCase(), l.id] as const),
  )
  const escaped = names.map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
  return {
    re: new RegExp(`(?<![\\w])(?:${escaped.join('|')})(?![\\w])`, 'gi'),
    byName,
  }
}

function linkify(text: string, matcher: Matcher | null): ReactNode {
  if (!matcher) return text
  const out: ReactNode[] = []
  let last = 0
  for (const m of text.matchAll(matcher.re)) {
    const at = m.index ?? 0
    const id = matcher.byName.get(m[0].toLowerCase())
    if (!id) continue
    if (at > last) out.push(text.slice(last, at))
    out.push(
      <button
        key={`${at}-${id}`}
        type="button"
        onClick={() => navigate(href.detail(id))}
        className="text-accent hover:text-accent-dim underline decoration-dotted underline-offset-2 transition-colors"
      >
        {m[0]}
      </button>,
    )
    last = at + m[0].length
  }
  if (out.length === 0) return text
  if (last < text.length) out.push(text.slice(last))
  return out
}
