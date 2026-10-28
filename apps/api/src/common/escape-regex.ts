/** Makes user input safe to embed in a RegExp: every metacharacter matches itself. */
export function escapeRegex(input: string): string {
  return input.replace(/[.*+?^${}()|[\]\\/-]/g, '\\$&');
}
