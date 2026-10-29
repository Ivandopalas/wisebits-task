const time = new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit' });
const weekday = new Intl.DateTimeFormat(undefined, { weekday: 'short' });
const shortDate = new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short' });
const longDate = new Intl.DateTimeFormat(undefined, {
  weekday: 'long',
  day: 'numeric',
  month: 'long',
});
const fullDate = new Intl.DateTimeFormat(undefined, {
  day: 'numeric',
  month: 'long',
  year: 'numeric',
});

const DAY_MS = 86_400_000;

function startOfDay(date: Date): number {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

/** Whole calendar days between two dates in local time (DST-safe). */
export function daysBetween(a: Date, b: Date): number {
  return Math.round((startOfDay(b) - startOfDay(a)) / DAY_MS);
}

export function formatTime(iso: string): string {
  return time.format(new Date(iso));
}

/** Conversation list: time today, weekday this week, date otherwise. */
export function formatListTime(iso: string, now = new Date()): string {
  const date = new Date(iso);
  const days = daysBetween(date, now);
  if (days === 0) return time.format(date);
  if (days < 7) return weekday.format(date);
  return shortDate.format(date);
}

export function formatDayLabel(iso: string, now = new Date()): string {
  const date = new Date(iso);
  const days = daysBetween(date, now);
  if (days === 0) return 'Today';
  if (days === 1) return 'Yesterday';
  if (date.getFullYear() === now.getFullYear()) return longDate.format(date);
  return fullDate.format(date);
}

export interface DayGroup<T> {
  day: string;
  items: T[];
}

export function groupByDay<T extends { createdAt: string }>(items: T[]): DayGroup<T>[] {
  const groups: DayGroup<T>[] = [];
  let currentKey = '';
  for (const item of items) {
    const key = new Date(startOfDay(new Date(item.createdAt))).toISOString();
    if (key !== currentKey) {
      groups.push({ day: item.createdAt, items: [] });
      currentKey = key;
    }
    groups[groups.length - 1]!.items.push(item);
  }
  return groups;
}

export function formatRelative(iso: string, now = Date.now()): string {
  const minutes = Math.round((now - new Date(iso).getTime()) / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  return `${hours}h ago`;
}
