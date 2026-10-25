export class ApiError extends Error {
  readonly status: number;
  readonly detail: unknown;

  constructor(message: string, status: number, detail: unknown) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.detail = detail;
  }
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown> : null;
}

export function formatApiErrorDetail(detail: unknown): string | null {
  if (typeof detail === 'string') return detail.trim() || null;
  if (Array.isArray(detail)) {
    const messages = detail.map(item => {
      const error = record(item);
      if (!error || typeof error.msg !== 'string') return formatApiErrorDetail(item);
      const location = Array.isArray(error.loc)
        ? error.loc.filter(part => (typeof part === 'string' && part !== 'body') || typeof part === 'number').join('.') : '';
      return location ? `${location}: ${error.msg}` : error.msg;
    }).filter((message): message is string => Boolean(message));
    return messages.length ? messages.slice(0, 4).join('; ') : null;
  }
  const error = record(detail);
  if (error) {
    for (const field of ['message', 'msg', 'detail', 'error']) {
      const message = formatApiErrorDetail(error[field]);
      if (message) return message;
    }
  }
  return null;
}

export function isUnsupportedBriefRefresh(error: unknown): error is ApiError {
  return error instanceof ApiError && error.status === 422
    && Array.isArray(error.detail) && error.detail.length > 0
    && error.detail.every(item => {
      const entry = record(item);
      return entry?.type === 'extra_forbidden' && Array.isArray(entry.loc)
        && entry.loc.length === 2 && entry.loc[0] === 'body' && entry.loc[1] === 'refresh';
    });
}
