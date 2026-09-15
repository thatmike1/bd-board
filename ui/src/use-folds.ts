// which index sections are folded, kept in localStorage per section key

import { useCallback, useState } from 'react'

const STORAGE_KEY = 'bd-board:folds'

export interface Folds {
  /** stored fold state, or `fallback` for a section nobody has touched yet */
  isFolded: (sectionKey: string, fallback: boolean) => boolean
  setFolded: (sectionKey: string, folded: boolean) => void
}

function read(): Record<string, boolean> {
  try {
    const parsed: unknown = JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? '{}')
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return {}
    return Object.fromEntries(
      Object.entries(parsed).filter(
        (entry): entry is [string, boolean] => typeof entry[1] === 'boolean',
      ),
    )
  } catch {
    return {}
  }
}

/** fold state that survives a reload */
export function useFolds(): Folds {
  const [stored, setStored] = useState<Record<string, boolean>>(read)

  const isFolded = useCallback(
    (sectionKey: string, fallback: boolean) => stored[sectionKey] ?? fallback,
    [stored],
  )

  const setFolded = useCallback((sectionKey: string, folded: boolean) => {
    setStored((prev) => {
      const next = { ...prev, [sectionKey]: folded }
      try {
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
      } catch {
        // storage full or blocked: the fold still holds for this page
      }
      return next
    })
  }, [])

  return { isFolded, setFolded }
}
