const PALETTE = [
  'bg-rose-500',
  'bg-orange-500',
  'bg-amber-500',
  'bg-emerald-500',
  'bg-teal-500',
  'bg-sky-500',
  'bg-indigo-500',
  'bg-violet-500',
  'bg-fuchsia-500',
];

/** Same user, same color, on every screen and every visit. */
export function avatarColor(seed: string): string {
  let hash = 0;
  for (const char of seed) {
    hash = (hash * 31 + char.charCodeAt(0)) | 0;
  }
  return PALETTE[Math.abs(hash) % PALETTE.length]!;
}

export function initials(username: string): string {
  const parts = username.split(/[._]/).filter(Boolean);
  const letters = parts.length > 1 ? parts[0]![0]! + parts[1]![0]! : username.slice(0, 2);
  return letters.toUpperCase();
}
