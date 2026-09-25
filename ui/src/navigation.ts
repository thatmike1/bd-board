import { shortId } from './model'

/** write a bead hash, adding history only when a user opens a different bead */
export function writeSelectionHash(
  id: string,
  previousId: string | null,
  repoName: string,
  userInitiated: boolean,
): void {
  const short = repoName ? shortId(id, repoName) : id
  if (decodeURIComponent(window.location.hash.slice(1)) === short) return
  const method = userInitiated && previousId !== id ? 'pushState' : 'replaceState'
  window.history[method](null, '', `#${short}`)
}
