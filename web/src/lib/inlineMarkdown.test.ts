import { describe, expect, it } from 'vitest'
import { tokenizeInline } from './inlineMarkdown'

describe('tokenizeInline', () => {
  it('passes plain text through as one token', () => {
    expect(tokenizeInline('no markdown here')).toEqual([
      { kind: 'text', text: 'no markdown here' },
    ])
  })

  it('tokenizes **bold** spans', () => {
    expect(tokenizeInline('try **Ardbeg 10** next')).toEqual([
      { kind: 'text', text: 'try ' },
      { kind: 'bold', text: 'Ardbeg 10' },
      { kind: 'text', text: ' next' },
    ])
  })

  it('tokenizes *italic* spans and mixes with bold', () => {
    expect(tokenizeInline('**A** then *quietly* B')).toEqual([
      { kind: 'bold', text: 'A' },
      { kind: 'text', text: ' then ' },
      { kind: 'italic', text: 'quietly' },
      { kind: 'text', text: ' B' },
    ])
  })

  it('handles adjacent and leading/trailing emphasis', () => {
    expect(tokenizeInline('**a****b**')).toEqual([
      { kind: 'bold', text: 'a' },
      { kind: 'bold', text: 'b' },
    ])
  })

  it('leaves unclosed markers as literal text', () => {
    expect(tokenizeInline('a ** dangling')).toEqual([
      { kind: 'text', text: 'a ** dangling' },
    ])
  })

  it('handles the empty string', () => {
    expect(tokenizeInline('')).toEqual([])
  })
})
