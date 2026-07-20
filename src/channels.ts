// Central source of truth for camera channels (front / interior / rear).
// A Viofo 3-channel unit (e.g. A229 Plus) records F, I and R files that share
// a session prefix. The order below is the canonical display / sync order:
// front is primary (usually the GPS source), then interior, then rear.

export type ChannelId = 'front' | 'interior' | 'rear' | 'unknown'

const RANK: Record<string, number> = { front: 0, interior: 1, rear: 2, unknown: 3 }
const LABEL: Record<string, string> = { front: 'FRONT', interior: 'INTERIOR', rear: 'REAR' }
const SHORT: Record<string, string> = { front: 'F', interior: 'I', rear: 'R' }
const COLOR: Record<string, string> = { front: 'var(--accent)', interior: '#c084fc', rear: '#4da6ff' }
const BADGE: Record<string, string> = { front: 'badge--f', interior: 'badge--i', rear: 'badge--r' }

/** Sort index — front, interior, rear, then anything unknown. */
export const channelRank = (ch: string): number => RANK[ch] ?? 3

/** Uppercase overlay label, e.g. 'FRONT'. Falls back to 'VIDEO' for unknown. */
export const channelLabel = (ch: string): string => LABEL[ch] ?? 'VIDEO'

/** One-letter badge text, e.g. 'F'. Falls back to '?' for unknown. */
export const channelShort = (ch: string): string => SHORT[ch] ?? '?'

/** Accent color for a channel's label / badge. */
export const channelColor = (ch: string): string => COLOR[ch] ?? 'var(--txt3)'

/** CSS class for the clip-card badge. */
export const channelBadgeClass = (ch: string): string => BADGE[ch] ?? 'badge--f'

/** Comparator that orders items by canonical channel order. */
export const byChannel =
  <T>(get: (t: T) => string) =>
  (a: T, b: T): number =>
    channelRank(get(a)) - channelRank(get(b))
