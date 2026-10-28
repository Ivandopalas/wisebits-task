interface Issue {
  path: PropertyKey[];
  message: string;
}

/** First message per top-level field, for showing next to inputs. */
export function fieldErrors(issues: readonly Issue[]): Record<string, string> {
  const result: Record<string, string> = {};
  for (const issue of issues) {
    const field = String(issue.path[0] ?? '');
    if (field && !(field in result)) {
      result[field] = issue.message;
    }
  }
  return result;
}
