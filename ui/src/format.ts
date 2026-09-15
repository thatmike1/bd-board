// small display helpers shared by the panes

import type { BoardConfig } from './api'

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/** 3 Sep 2026 */
export function formatDate(iso: string | null | undefined): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return `${d.getDate()} ${MONTHS[d.getMonth()] ?? ''} ${d.getFullYear()}`
}

/** 3 Sep, for tight columns */
export function formatShortDate(iso: string | null | undefined): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return `${d.getDate()} ${MONTHS[d.getMonth()] ?? ''}`
}

/** clock time on the day the list was fetched */
export function formatTime(iso: string | null | undefined): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return d.toTimeString().slice(0, 5)
}

/** status as it reads in the ui */
export function statusLabel(status: string): string {
  return status === 'in_progress' ? 'in progress' : status
}

/** the css custom properties that tint a row or the detail header for an axis */
export function axisStyle(axis: string | null, config?: BoardConfig): Record<string, string> {
  if (axis && config) {
    const lane = config.lanes.find((l) => l.label === axis)
    if (lane) {
      return {
        '--axis': lane.color,
        '--fill-row': `color-mix(in srgb, ${lane.color} 14%, transparent)`,
      }
    }
  }
  return { '--axis': 'var(--none)', '--fill-row': 'var(--none-fill)' }
}

/** the mono glyph that marks a lane, so lanes read without colour */
export function laneGlyph(axis: string | null, config?: BoardConfig): string {
  if (axis && config) {
    const lane = config.lanes.find((l) => l.label === axis)
    if (lane) return lane.glyph
  }
  return '\u00b7'
}

/** the color configured for a lane */
export function laneColor(axis: string | null, config?: BoardConfig): string | undefined {
  if (axis && config) {
    const lane = config.lanes.find((l) => l.label === axis)
    if (lane) return lane.color
  }
  return undefined
}
