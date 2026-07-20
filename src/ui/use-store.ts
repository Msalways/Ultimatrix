/**
 * React subscription hook for the UiStore. Forces a re-render whenever the
 * store notifies. Keeps the Ink tree declarative: panes read `store` props and
 * this hook triggers repaint — no manual painting, no raw stdout.
 */

import { useReducer, useEffect } from 'react'
import { getUiStore, type UiStore } from './store'

export function useUiStore(): UiStore {
  const store = getUiStore()
  const [, force] = useReducer((x: number) => x + 1, 0)
  useEffect(() => store.subscribe(force), [store])
  return store
}
