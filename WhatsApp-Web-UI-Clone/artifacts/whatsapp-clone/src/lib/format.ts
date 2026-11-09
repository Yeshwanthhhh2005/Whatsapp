/** Date / size formatting shared by the chat list and message bubbles. */

/**
 * Parse a timestamp from the API.
 *
 * PostgreSQL TIMESTAMPTZ serialises with an offset, but SQLite (used by the
 * backend's test suite and by anyone running it without Postgres) does not.
 * A bare `2026-10-08T11:54:40` is interpreted as *local* time by `Date`, which
 * would shift every timestamp by the viewer's UTC offset. The backend stores
 * UTC, so assume UTC when no offset is present.
 */
export function parseTimestamp(value: string | null | undefined): Date | null {
  if (!value) return null;
  const hasZone = /(?:Z|[+-]\d{2}:?\d{2})$/.test(value);
  const date = new Date(hasZone ? value : `${value}Z`);
  return Number.isNaN(date.getTime()) ? null : date;
}

const timeFormat = new Intl.DateTimeFormat(undefined, {
  hour: '2-digit',
  minute: '2-digit',
});

const weekdayFormat = new Intl.DateTimeFormat(undefined, { weekday: 'short' });

const dayFormat = new Intl.DateTimeFormat(undefined, {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
});

function startOfDay(date: Date): number {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

function daysAgo(date: Date): number {
  const dayMs = 86_400_000;
  return Math.round((startOfDay(new Date()) - startOfDay(date)) / dayMs);
}

/** Clock time, e.g. "11:42". Used inside message bubbles. */
export function formatTime(value: string | null | undefined): string {
  const date = parseTimestamp(value);
  return date ? timeFormat.format(date) : '';
}

/** WhatsApp-style relative stamp for the conversation list. */
export function formatListTimestamp(value: string | null | undefined): string {
  const date = parseTimestamp(value);
  if (!date) return '';
  const days = daysAgo(date);
  if (days <= 0) return timeFormat.format(date);
  if (days === 1) return 'Yesterday';
  if (days < 7) return weekdayFormat.format(date);
  return dayFormat.format(date);
}

/** Separator label between days in the message list. */
export function formatDayDivider(value: string | null | undefined): string {
  const date = parseTimestamp(value);
  if (!date) return '';
  const days = daysAgo(date);
  if (days <= 0) return 'TODAY';
  if (days === 1) return 'YESTERDAY';
  return dayFormat.format(date).toUpperCase();
}

/** Stable key identifying the calendar day a message belongs to. */
export function dayKey(value: string | null | undefined): string {
  const date = parseTimestamp(value);
  return date ? String(startOfDay(date)) : '';
}

/** "last seen today at 10:24" / "online", for the chat header. */
export function formatPresence(
  isOnline: boolean,
  lastSeen: string | null | undefined,
): string {
  if (isOnline) return 'online';
  const date = parseTimestamp(lastSeen);
  if (!date) return 'offline';
  const days = daysAgo(date);
  if (days <= 0) return `last seen today at ${timeFormat.format(date)}`;
  if (days === 1) return `last seen yesterday at ${timeFormat.format(date)}`;
  return `last seen ${dayFormat.format(date)}`;
}

export function formatFileSize(bytes: number | null | undefined): string {
  if (bytes == null) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** Initials for the avatar placeholder, e.g. "Maya Chen" -> "MC". */
export function initialsOf(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return '?';
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return (words[0][0] + words[words.length - 1][0]).toUpperCase();
}

/**
 * Deterministic avatar colour, so a given person keeps the same one across
 * reloads and across devices without storing anything.
 */
const AVATAR_COLORS = [
  '#b88776', '#718e7c', '#b29b66', '#bc8a9a', '#b97851', '#7895a1',
  '#aa906e', '#817fa6', '#6b987f', '#867b6d', '#7792a3', '#d29d64',
  '#84976e', '#9e8b7a', '#a58191', '#779279', '#a58769', '#8c8baa',
];

export function colorFor(id: string): string {
  let hash = 0;
  for (let index = 0; index < id.length; index += 1) {
    hash = (hash * 31 + id.charCodeAt(index)) >>> 0;
  }
  return AVATAR_COLORS[hash % AVATAR_COLORS.length];
}

/** One-line preview for the conversation list. */
export function previewOf(
  message: { content: string | null; message_type: string; is_deleted: boolean; file_name: string | null } | null,
): string {
  if (!message) return 'No messages yet';
  if (message.is_deleted) return 'This message was deleted';
  if (message.message_type === 'image') return message.content || '\u{1F4F7} Photo';
  if (message.message_type === 'document') {
    return message.file_name ? `\u{1F4C4} ${message.file_name}` : '\u{1F4C4} Document';
  }
  return message.content ?? '';
}
