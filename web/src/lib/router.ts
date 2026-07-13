/**
 * Tiny hash router. The sibling sites are single-view SPAs, but dram has a
 * list ↔ detail structure plus a coffee tab, so a minimal hash router keeps
 * deep-links working (and PWA-friendly) without pulling in react-router.
 *
 *   #/                 -> bottle list (the cabinet — alcohol)
 *   #/coffee           -> coffee list (the coffee bar)
 *   #/bottles/:id      -> bottle detail
 *   #/add              -> add-bottle form (defaults to a cabinet type)
 *   #/add/coffee       -> add-bottle form (defaults to coffee)
 *   #/bottles/:id/edit -> edit-bottle form
 */
import { useEffect, useState } from 'react'
import type { BeverageFamily } from './types'

export type Route =
  | { name: 'list'; family: BeverageFamily }
  | { name: 'detail'; id: string }
  | { name: 'add'; family: BeverageFamily }
  | { name: 'edit'; id: string }

export function parseHash(hash: string): Route {
  const path = hash.replace(/^#/, '') || '/'
  const parts = path.split('/').filter(Boolean) // e.g. ['bottles','b-1','edit']

  if (parts.length === 0) return { name: 'list', family: 'alcohol' }
  if (parts[0] === 'coffee') return { name: 'list', family: 'coffee' }
  if (parts[0] === 'add') {
    return { name: 'add', family: parts[1] === 'coffee' ? 'coffee' : 'alcohol' }
  }
  if (parts[0] === 'bottles' && parts[1]) {
    if (parts[2] === 'edit') return { name: 'edit', id: parts[1] }
    return { name: 'detail', id: parts[1] }
  }
  return { name: 'list', family: 'alcohol' }
}

export function useRoute(): Route {
  const [route, setRoute] = useState<Route>(() =>
    parseHash(window.location.hash),
  )
  useEffect(() => {
    const onChange = () => setRoute(parseHash(window.location.hash))
    window.addEventListener('hashchange', onChange)
    return () => window.removeEventListener('hashchange', onChange)
  }, [])
  return route
}

export function navigate(to: string): void {
  const target = to.startsWith('#') ? to : `#${to}`
  if (window.location.hash === target) {
    // Same hash — hashchange won't fire; nudge scroll to top instead.
    window.scrollTo({ top: 0 })
    return
  }
  window.location.hash = target
  window.scrollTo({ top: 0 })
}

export const href = {
  list: (family: BeverageFamily = 'alcohol') =>
    family === 'coffee' ? '#/coffee' : '#/',
  detail: (id: string) => `#/bottles/${id}`,
  add: (family: BeverageFamily = 'alcohol') =>
    family === 'coffee' ? '#/add/coffee' : '#/add',
  edit: (id: string) => `#/bottles/${id}/edit`,
}
