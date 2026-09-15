// shell: queries, selection, writes with undo, keyboard

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import * as api from './api'
import type { BoardConfig, Issue, IssueDetail, IssueList, Status } from './api'
import { buildBoard, sectionsHolding, shortId, step } from './model'
import { IndexPane } from './components/index-pane'
import { DetailPane } from './components/detail-pane'
import { Toast } from './components/toast'
import { useToast } from './use-toast'
import { useFolds } from './use-folds'

const EMPTY_CONFIG: BoardConfig = {
  agentsview: null,
  notesDir: null,
  lanes: [],
  unlaned: { title: 'open', note: null },
  subLabels: [],
  waiting: { labels: [], title: 'waiting on you', note: null },
  note: { addLabel: null, offerToClear: [] },
  thoughts: null,
  flags: [],
  capture: { labels: [] },
  derived: { allFlags: [], hotChips: [] },
}

interface WriteSpec {
  /** local guess applied before the server answers */
  optimistic: Issue | null
  call: () => Promise<{ issue: Issue }>
  message: string
  /** inverse action, offered behind the toast's undo button */
  undo: (() => Promise<void>) | null
}

/** the whole board: dense index on the left, one bead open on the right */
export function App() {
  const qc = useQueryClient()
  const toaster = useToast()
  const folds = useFolds()
  const { setFolded } = folds
  const noteRef = useRef<HTMLTextAreaElement>(null)
  const captureRef = useRef<HTMLInputElement>(null)

  const sessionQuery = useQuery({
    queryKey: ['session'],
    queryFn: api.getSession,
    staleTime: Infinity,
  })
  const issuesQuery = useQuery({
    queryKey: ['issues'],
    queryFn: api.getIssues,
    refetchInterval: 20_000,
    refetchOnWindowFocus: true,
  })

  const [selected, setSelected] = useState<string | null>(null)
  const [drafts, setDrafts] = useState<Record<string, string>>({})
  const [clears, setClears] = useState<Record<string, boolean>>({})
  const [capture, setCapture] = useState('')
  const [sending, setSending] = useState(false)

  const session = sessionQuery.data
  const repoName = session?.repo.name ?? ''
  const config = session?.config ?? EMPTY_CONFIG
  const me = session?.me ?? 'unknown'
  const issues = issuesQuery.data?.issues

  const board = useMemo(
    () =>
      buildBoard(issues ?? [], {
        config,
        repoName,
        isFolded: folds.isFolded,
      }),
    [issues, config, repoName, folds.isFolded],
  )

  const knownLabels = useMemo(() => {
    const seen = new Set<string>([
      ...config.lanes.map((l) => l.label),
      ...config.derived.allFlags,
      ...config.subLabels,
    ])
    for (const issue of issues ?? []) for (const label of issue.labels) seen.add(label)
    return [...seen]
  }, [issues, config])

  const select = useCallback(
    (id: string) => {
      if (!id) return
      setSelected(id)
      const short = repoName ? shortId(id, repoName) : id
      if (decodeURIComponent(window.location.hash.slice(1)) !== short) {
        window.history.replaceState(null, '', `#${short}`)
      }
    },
    [repoName],
  )

  // a bead reached through the hash may sit only inside folded sections: open the first of them
  const reveal = useCallback(
    (id: string) => {
      const holding = sectionsHolding(board, id)
      const first = holding[0]
      if (first && holding.every((s) => s.folded)) folds.setFolded(first.key, false)
    },
    [board, folds],
  )

  // first paint: the hash wins, otherwise the first row of the index
  useEffect(() => {
    if (selected || !issues?.length) return
    const wanted = decodeURIComponent(window.location.hash.slice(1))
    const match = wanted
      ? issues.find((i) => i.id === wanted || shortId(i.id, repoName) === wanted)
      : undefined
    const next = match?.id ?? board.order[0] ?? issues[0]?.id ?? null
    if (next) {
      if (match) reveal(match.id)
      select(next)
    }
  }, [selected, issues, board.order, repoName, select, reveal])

  // the hash is editable, so follow it when it changes under us
  useEffect(() => {
    const onHash = () => {
      const wanted = decodeURIComponent(window.location.hash.slice(1))
      const match = (issues ?? []).find(
        (i) => i.id === wanted || shortId(i.id, repoName) === wanted,
      )
      if (match) {
        reveal(match.id)
        setSelected(match.id)
      }
    }
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [issues, repoName, reveal])

  const detailQuery = useQuery({
    queryKey: ['issue', selected],
    queryFn: () => api.getIssue(selected as string),
    enabled: selected !== null,
  })

  const applyIssue = useCallback(
    (next: Issue) => {
      qc.setQueryData<IssueList>(['issues'], (prev) =>
        prev ? { ...prev, issues: prev.issues.map((i) => (i.id === next.id ? next : i)) } : prev,
      )
      qc.setQueryData<IssueDetail>(['issue', next.id], (prev) =>
        prev ? { ...prev, issue: next } : prev,
      )
    },
    [qc],
  )

  const refresh = useCallback(
    (id: string | null) => {
      void qc.invalidateQueries({ queryKey: ['issues'] })
      if (id) void qc.invalidateQueries({ queryKey: ['issue', id] })
    },
    [qc],
  )

  const write = useCallback(
    async (id: string, spec: WriteSpec) => {
      if (spec.optimistic) applyIssue(spec.optimistic)
      try {
        const { issue } = await spec.call()
        applyIssue(issue)
        toaster.show(spec.message, spec.undo ?? undefined)
      } catch (error: unknown) {
        toaster.fail(error instanceof Error ? error.message : 'write failed')
      } finally {
        refresh(id)
      }
    },
    [applyIssue, refresh, toaster],
  )

  // the polled list is the record of truth for status, labels and priority; the detail
  // query adds notes, comments and the two joins
  const selectedIssue = selected ? board.byId.get(selected) : undefined
  const current = selectedIssue ?? detailQuery.data?.issue

  const onPriority = useCallback(
    (priority: number) => {
      if (!current) return
      const before = current.priority
      if (before === priority) return
      const id = current.id
      const short = shortId(id, repoName)
      void write(id, {
        optimistic: { ...current, priority: priority as Issue['priority'] },
        call: () => api.setPriority(id, priority),
        message: `${short} set to p${priority}`,
        undo: async () => {
          await api.setPriority(id, before)
          refresh(id)
        },
      })
    },
    [current, repoName, write, refresh],
  )

  const onStatus = useCallback(
    (status: Status) => {
      if (!current) return
      const before = current.status
      if (before === status) return
      const id = current.id
      const short = shortId(id, repoName)
      const verb = status === 'closed' ? 'closed' : status === 'deferred' ? 'deferred' : 'reopened'
      void write(id, {
        optimistic: { ...current, status },
        call: () => api.setStatus(id, status),
        message: `${short} ${verb}`,
        undo: async () => {
          await api.setStatus(id, before)
          refresh(id)
        },
      })
    },
    [current, repoName, write, refresh],
  )

  const onLabels = useCallback(
    (change: { add?: string[]; remove?: string[] }) => {
      if (!current) return
      const id = current.id
      const short = shortId(id, repoName)
      const add = change.add ?? []
      const remove = change.remove ?? []
      if (!add.length && !remove.length) return
      const labels = current.labels.filter((l) => !remove.includes(l)).concat(add)
      const what = add.length ? `+${add.join(' +')}` : `-${remove.join(' -')}`
      void write(id, {
        optimistic: { ...current, labels },
        call: () => api.editLabels(id, change),
        message: `${short} ${what}`,
        undo: async () => {
          await api.editLabels(id, { add: remove, remove: add })
          refresh(id)
        },
      })
    },
    [current, repoName, write, refresh],
  )

  const onSend = useCallback(() => {
    if (!current) return
    const id = current.id
    const text = (drafts[id] ?? '').trim()
    if (!text || sending) return
    const presentClears = config.note.offerToClear.filter((l) => current.labels.includes(l))
    const clear = presentClears.length > 0 && (clears[id] ?? true)
    setSending(true)
    void api
      .postComment(id, text, clear)
      .then((detail) => {
        qc.setQueryData<IssueDetail>(['issue', id], detail)
        applyIssue(detail.issue)
        setDrafts((prev) => ({ ...prev, [id]: '' }))
        const short = shortId(id, repoName)
        let msg = `note on ${short}`
        if (config.note.addLabel) msg += `, ${config.note.addLabel} set`
        if (clear) msg += `, ${presentClears.join(', ')} cleared`
        toaster.show(msg)
      })
      .catch((error: unknown) => {
        toaster.fail(error instanceof Error ? error.message : 'comment failed')
      })
      .finally(() => {
        setSending(false)
        refresh(id)
      })
  }, [current, drafts, clears, sending, qc, applyIssue, toaster, repoName, refresh, config])

  const onCaptureSubmit = useCallback(() => {
    const title = capture.trim()
    if (!title) return
    setCapture('')
    void api
      .createIssue(title)
      .then(({ issue }) => {
        qc.setQueryData<IssueList>(['issues'], (prev) =>
          prev ? { ...prev, issues: [...prev.issues, issue] } : prev,
        )
        select(issue.id)
        const labelText =
          config.capture.labels.length > 0
            ? ` as ${config.capture.labels.join(' + ')}`
            : ''
        toaster.show(`filed ${shortId(issue.id, repoName)}${labelText}`, async () => {
          await api.deleteIssue(issue.id)
          qc.setQueryData<IssueList>(['issues'], (prev) =>
            prev ? { ...prev, issues: prev.issues.filter((i) => i.id !== issue.id) } : prev,
          )
          setSelected(null)
          window.history.replaceState(null, '', ' ')
          refresh(null)
        })
      })
      .catch((error: unknown) => {
        setCapture(title)
        toaster.fail(error instanceof Error ? error.message : 'capture failed')
      })
      .finally(() => refresh(null))
  }, [capture, qc, select, toaster, repoName, refresh, config])

  const onToggleSection = useCallback(
    (sectionKey: string) => {
      const section = board.sections.find((s) => s.key === sectionKey)
      if (section) setFolded(sectionKey, !section.folded)
    },
    [board, setFolded],
  )

  const onCopyId = useCallback(
    (id: string) => {
      const short = shortId(id, repoName)
      void navigator.clipboard.writeText(short).then(
        () => toaster.show(`copied ${short}`),
        () => toaster.fail(`could not copy ${short}`),
      )
    },
    [repoName, toaster],
  )

  // keyboard: movement, folds, the note box, copy, defer and close, quick capture
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null
      const typing =
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        target?.isContentEditable === true
      if (typing) return
      if (e.metaKey || e.ctrlKey || e.altKey) return

      if (e.key === 'ArrowDown' || e.key === 'j') {
        e.preventDefault()
        const next = step(board, selected, 1)
        if (next) select(next)
      } else if (e.key === 'ArrowUp' || e.key === 'k') {
        e.preventDefault()
        const next = step(board, selected, -1)
        if (next) select(next)
      } else if (e.key === 'h' || e.key === 'l') {
        e.preventDefault()
        if (!selected) return
        const fold = e.key === 'h'
        const section = sectionsHolding(board, selected).find((s) => s.folded !== fold)
        if (section) setFolded(section.key, fold)
      } else if (e.key === 'c') {
        e.preventDefault()
        if (selected) onCopyId(selected)
      } else if (e.key === 'n' || e.key === 'm') {
        e.preventDefault()
        const status = e.key === 'n' ? 'deferred' : 'closed'
        if (!selected || board.byId.get(selected)?.status === status) return
        // the bead leaves its section, so the selection moves on to the row below it
        const below = step(board, selected, 1)
        const next = below && below !== selected ? below : step(board, selected, -1)
        onStatus(status)
        if (next && next !== selected) select(next)
      } else if (e.key === 'Enter') {
        e.preventDefault()
        noteRef.current?.focus()
      } else if (e.key === 'Escape') {
        ;(document.activeElement as HTMLElement | null)?.blur()
      } else if (e.key === '/') {
        e.preventDefault()
        captureRef.current?.focus()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [board, selected, select, setFolded, onCopyId, onStatus])

  if (sessionQuery.isError || issuesQuery.isError) {
    const error = sessionQuery.error ?? issuesQuery.error
    return (
      <div className="loading">
        no answer from the bd-board server on /api. {error instanceof Error ? error.message : ''}
      </div>
    )
  }
  if (!session || !issues) return <div className="loading">reading the ledger…</div>

  const draft = selected ? (drafts[selected] ?? '') : ''
  const clear = selected ? (clears[selected] ?? true) : true

  return (
    <>
      <div className="app">
        <IndexPane
          board={board}
          repoName={repoName}
          config={config}
          selected={selected}
          onSelect={select}
          onToggleSection={onToggleSection}
          captureRef={captureRef}
          captureValue={capture}
          onCaptureChange={setCapture}
          onCaptureSubmit={onCaptureSubmit}
          fetchedAt={issuesQuery.data?.fetchedAt}
        />
        <DetailPane
          issue={current}
          detail={detailQuery.data}
          repoName={repoName}
          config={config}
          me={me}
          knownLabels={knownLabels}
          noteRef={noteRef}
          note={draft}
          onNoteChange={(value) => {
            if (selected) setDrafts((prev) => ({ ...prev, [selected]: value }))
          }}
          clear={clear}
          onClearChange={(value) => {
            if (selected) setClears((prev) => ({ ...prev, [selected]: value }))
          }}
          onSend={onSend}
          sending={sending}
          onPriority={onPriority}
          onStatus={onStatus}
          onLabels={onLabels}
          onCopyId={onCopyId}
        />
      </div>
      <Toast toast={toaster.toast} onUndo={toaster.runUndo} onDismiss={toaster.dismiss} />
    </>
  )
}
