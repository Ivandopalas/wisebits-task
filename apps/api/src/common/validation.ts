import { BadRequestException, StandardSchemaValidationPipe } from '@nestjs/common';

interface Issue {
  message: string;
  path?: ReadonlyArray<PropertyKey | { key: PropertyKey }>;
}

export function formatIssues(issues: ReadonlyArray<Issue>) {
  return issues.map((issue) => ({
    path: (issue.path ?? [])
      .map((segment) => String(typeof segment === 'object' ? segment.key : segment))
      .join('.'),
    message: issue.message,
  }));
}

/** One pipe for HTTP and socket payloads, so both report validation errors the same way. */
export function createValidationPipe() {
  return new StandardSchemaValidationPipe({
    exceptionFactory: (issues: ReadonlyArray<Issue>) =>
      new BadRequestException({ message: 'Validation failed', details: formatIssues(issues) }),
  });
}
