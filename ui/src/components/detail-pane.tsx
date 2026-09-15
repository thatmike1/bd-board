// the right pane: one bead, always open, with the note box pinned at its foot

import type { CSSProperties, RefObject } from 'react'
import type { BoardConfig, Issue, IssueDetail, Status } from '../api'
import { axisOf, flagsOf, projectOf, shortId } from '../model'
import { axisStyle, formatDate, formatShortDate, statusLabel } from '../format'
import { WriteRow } from './write-row'
import { NoteBox } from './note-box'

interface DetailPaneProps {
  issue: Issue | undefined
  detail: IssueDetail | undefined
  repoName: string
  config: BoardConfig
  me: string
  knownLabels: string[]
  noteRef: RefObject<HTMLTextAreaElement | null>
  note: string
  onNoteChange: (value: string) => void
  clear: boolean
  onClearChange: (value: boolean) => void
  onSend: () => void
  sending: boolean
  onPriority: (priority: number) => void
  onStatus: (status: Status) => void
  onLabels: (change: { add?: string[]; remove?: string[] }) => void
  onCopyId: (id: string) => void
}

function paragraphs(text: string): string[] {
  return text.split(/\n{2,}/).filter((p) => p.trim().length > 0)
}

/** detail of the selected bead; the list record paints the header before the join lands */
export function DetailPane(props: DetailPaneProps) {
  const { issue, detail, repoName, config, me, knownLabels } = props
  if (!issue) {
    return (
      <main className="read">
        <div className="loading">no bead selected.</div>
      </main>
    )
  }

  const full = issue
  const short = shortId(full.id, repoName)
  const axis = axisOf(full, config.lanes)
  const project = projectOf(full, config)
  const flags = flagsOf(full, config.derived.allFlags)
  const comments = detail?.comments ?? []
  const lastComment = comments.length ? comments[comments.length - 1] : undefined
  const unread =
    config.note.addLabel && full.labels.includes(config.note.addLabel) ? lastComment : undefined
  // the unread note is shown on its own above, so it does not repeat in the list
  const earlier = unread ? comments.slice(0, -1) : comments

  return (
    <main className="read" style={axisStyle(axis, config) as CSSProperties}>
      <div className="rhead">
        <div className="rline">
          <span className="dot" />
          <button
            className="mono copyid"
            style={{ color: 'var(--ink-2)' }}
            title="copy id"
            onClick={() => props.onCopyId(full.id)}
          >
            {short}
          </button>
          {config.lanes.length ? <span className="axis">{axis ?? config.unlaned.title}</span> : null}
          <span>{statusLabel(full.status)}</span>
          <span className="right">
            <span>
              {full.comment_count} {full.comment_count === 1 ? 'comment' : 'comments'}
            </span>
            <span>touched {formatDate(full.updated_at)}</span>
          </span>
        </div>
        <WriteRow
          issue={full}
          knownLabels={knownLabels}
          onPriority={props.onPriority}
          onStatus={props.onStatus}
          onLabels={props.onLabels}
        />
      </div>

      <div className="rbody" key={full.id}>
        <div className="rwrap">
          <h1>{full.title}</h1>
          <div className="meta">
            <span>p{full.priority}</span>
            <span className="s">/</span>
            <span>{full.issue_type}</span>
            <span className="s">/</span>
            <span>opened {formatDate(full.created_at)}</span>
            <span className="s">/</span>
            <span>updated {formatDate(full.updated_at)}</span>
            {full.closed_at ? (
              <>
                <span className="s">/</span>
                <span>closed {formatDate(full.closed_at)}</span>
              </>
            ) : null}
            {full.dependency_count ? (
              <>
                <span className="s">/</span>
                <span>{full.dependency_count} blocked by</span>
              </>
            ) : null}
            {project ? (
              <>
                <span className="s">/</span>
                <span>{project}</span>
              </>
            ) : null}
            {flags.length ? (
              <span className="chips">
                {flags.map((flag) => (
                  <span
                    key={flag}
                    className={config.derived.hotChips.includes(flag) ? 'chip hot' : 'chip'}
                  >
                    {flag}
                  </span>
                ))}
              </span>
            ) : null}
          </div>

          {unread ? (
            <>
              <h2 className="sub">your note, still unread</h2>
              <div className={unread.author === me ? 'comment mine' : 'comment'}>
                <div className="chead">
                  <b>{unread.author}</b>
                  <span>{formatDate(unread.created_at)}</span>
                </div>
                <p>{unread.text}</p>
              </div>
            </>
          ) : null}

          <h2 className="sub">description</h2>
          <div className="prose">
            {full.description ? (
              paragraphs(full.description).map((p, i) => <p key={i}>{p}</p>)
            ) : (
              <p className="empty">no description on this bead.</p>
            )}
          </div>

          {issue.notes ? (
            <>
              <h2 className="sub">notes</h2>
              <div className="notes">
                {paragraphs(issue.notes).map((p, i) => (
                  <p key={i}>{p}</p>
                ))}
              </div>
            </>
          ) : null}

          <h2 className="sub">{unread ? 'earlier comments' : 'comments'}</h2>
          {earlier.length ? (
            earlier.map((c) => (
              <div className={c.author === me ? 'comment mine' : 'comment'} key={c.id}>
                <div className="chead">
                  <b>{c.author}</b>
                  <span>{formatDate(c.created_at)}</span>
                </div>
                <p>{c.text}</p>
              </div>
            ))
          ) : (
            <div className="empty">{unread ? 'nothing before it.' : 'no comments yet.'}</div>
          )}

          {detail && detail.sessions !== null ? (
            <>
              <h2 className="sub">sessions that touched it</h2>
              {detail.sessions.length ? (
                detail.sessions.map((s) => (
                  <div className="srow" key={s.session_id}>
                    <span className="sd mono">{formatShortDate(s.day)}</span>
                    <div className="smain">
                      <a href={s.url} target="_blank" rel="noreferrer">
                        {s.title}
                      </a>
                      {s.prompt ? <div className="sprompt">{s.prompt}</div> : null}
                    </div>
                    {s.agent ? <span className="chip">{s.agent}</span> : <span />}
                  </div>
                ))
              ) : (
                <div className="empty">no session mentions this id.</div>
              )}
            </>
          ) : null}

          {detail && detail.notes.length ? (
            <>
              <h2 className="sub">in notes</h2>
              {detail.notes.map((m, i) => (
                <div className="memrow" key={`${m.file}:${m.line}:${i}`}>
                  <span className="mono">
                    {m.file}:{m.line}
                  </span>
                  <div className="ex">{m.excerpt}</div>
                </div>
              ))}
            </>
          ) : null}
        </div>
      </div>

      <NoteBox
        issue={full}
        short={short}
        config={config}
        noteRef={props.noteRef}
        value={props.note}
        onChange={props.onNoteChange}
        clear={props.clear}
        onClearChange={props.onClearChange}
        onSend={props.onSend}
        sending={props.sending}
      />
    </main>
  )
}
