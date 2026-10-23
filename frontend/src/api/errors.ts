import { redactUrl } from '@/lib/capability-links';

/**
 * Every failed call becomes one ApiError (setup proposal §5.4). The backend's error body is
 * `{ statusCode, message, requestId, path, at }`, where `message` is a string or, for validation
 * failures, an array with one entry per bad field (docs/API.md §1).
 */
export interface ApiErrorInit {
  status: number;
  messages: readonly string[];
  requestId?: string | undefined;
  path?: string | undefined;
}

/** A message the backend prefixed with a field name, such as "members: …" or "answers: …". */
const FIELD_MESSAGE = /^([A-Za-z][\w.[\]-]*): (.+)$/;

export class ApiError extends Error {
  readonly status: number;
  readonly messages: readonly string[];
  /** Messages keyed by the field name the backend put in front of them. */
  readonly fieldErrors: Readonly<Record<string, readonly string[]>>;
  /** Messages that name no field. */
  readonly formErrors: readonly string[];
  readonly requestId: string | undefined;
  /** The API path, with any capability token removed. */
  readonly path: string | undefined;

  constructor(init: ApiErrorInit) {
    super(init.messages[0] ?? `Request failed with status ${init.status}`);
    this.name = 'ApiError';
    this.status = init.status;
    this.messages = init.messages;
    this.requestId = init.requestId;
    this.path = init.path === undefined ? undefined : redactUrl(init.path);
    const { fieldErrors, formErrors } = splitFieldMessages(init.messages);
    this.fieldErrors = fieldErrors;
    this.formErrors = formErrors;
  }
}

export function splitFieldMessages(messages: readonly string[]): {
  fieldErrors: Record<string, string[]>;
  formErrors: string[];
} {
  const fieldErrors: Record<string, string[]> = {};
  const formErrors: string[] = [];
  for (const message of messages) {
    const match = FIELD_MESSAGE.exec(message);
    if (match?.[1] && match[2]) {
      (fieldErrors[match[1]] ??= []).push(match[2]);
    } else {
      formErrors.push(message);
    }
  }
  return { fieldErrors, formErrors };
}

interface ErrorBody {
  message?: unknown;
  requestId?: unknown;
  path?: unknown;
}

function isErrorBody(body: unknown): body is ErrorBody {
  return typeof body === 'object' && body !== null;
}

/** Messages from whatever the server sent: an error body, plain text, or nothing. */
export function messagesFrom(body: unknown): string[] {
  if (typeof body === 'string') {
    return body ? [body] : [];
  }
  if (!isErrorBody(body)) {
    return [];
  }
  const { message } = body;
  if (Array.isArray(message)) {
    return message.filter((entry): entry is string => typeof entry === 'string');
  }
  return typeof message === 'string' ? [message] : [];
}

export function apiErrorFrom(response: Response, body: unknown, requestId?: string): ApiError {
  const fromBody =
    isErrorBody(body) && typeof body.requestId === 'string' ? body.requestId : undefined;
  const path = isErrorBody(body) && typeof body.path === 'string' ? body.path : undefined;
  return new ApiError({
    status: response.status,
    messages: messagesFrom(body),
    requestId: response.headers.get('x-request-id') ?? fromBody ?? requestId,
    path,
  });
}

/** A failure before any response: offline, DNS, a refused connection. */
export function networkError(requestId?: string): ApiError {
  return new ApiError({ status: 0, messages: [], requestId });
}

export function isApiError(error: unknown): error is ApiError {
  return error instanceof ApiError;
}
