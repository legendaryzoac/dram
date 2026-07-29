/**
 * Minimal inline-markdown tokenizer for AI narration text. The Haiku layer is
 * told "no markdown" but sometimes emits bold or italic asterisk markers
 * anyway; rather than showing literal asterisks, the panel renders these as
 * emphasis. Pure and DOM-free — the caller maps tokens to elements.
 */
export interface InlineToken {
  kind: 'text' | 'bold' | 'italic'
  text: string
}

const EMPHASIS = /\*\*([^*]+)\*\*|\*([^*]+)\*/g

export function tokenizeInline(src: string): InlineToken[] {
  const out: InlineToken[] = []
  let last = 0
  for (const m of src.matchAll(EMPHASIS)) {
    const at = m.index ?? 0
    if (at > last) out.push({ kind: 'text', text: src.slice(last, at) })
    if (m[1] !== undefined) out.push({ kind: 'bold', text: m[1] })
    else out.push({ kind: 'italic', text: m[2] })
    last = at + m[0].length
  }
  if (last < src.length) out.push({ kind: 'text', text: src.slice(last) })
  return out
}
