import { FeedbackCode, feedbackText } from './feedback-copy';

const LANGUAGES = ['en', 'ru', 'fr', 'hy'];
const STATUS_CODES: Record<number, FeedbackCode> = { 400: 'VALIDATION_FAILED', 401: 'SIGN_IN_REQUIRED', 403: 'FORBIDDEN', 404: 'NOT_FOUND',
  409: 'CONFLICT', 410: 'EXPIRED', 413: 'UPLOAD_TOO_LARGE', 422: 'VALIDATION_FAILED', 429: 'RATE_LIMITED', 503: 'SERVICE_UNAVAILABLE' };
const ACTIONS: Partial<Record<FeedbackCode, string>> = { VALIDATION_FAILED: 'EDIT', SIGN_IN_REQUIRED: 'SIGN_IN', FORBIDDEN: 'REQUEST_ACCESS',
  NOT_FOUND: 'CONTACT_HOST', CONFLICT: 'RELOAD', ATTENDANCE_CHANGED: 'RELOAD', EXPIRED: 'REGENERATE', UPLOAD_TOO_LARGE: 'EDIT',
  RATE_LIMITED: 'WAIT', STATE_CHANGED: 'WAIT', REGENERATE: 'REGENERATE', INVALID_IMAGE: 'REUPLOAD', JOB_LIMIT: 'CONTACT_SUPPORT' };
const JOB_CODES: Record<string, FeedbackCode> = { SUBJECT_ERASED: 'REGENERATE', ACCESS_REVOKED: 'FORBIDDEN', EVENT_UNAVAILABLE: 'NOT_FOUND',
  STORAGE_UNAVAILABLE: 'SERVICE_UNAVAILABLE', INVALID_IMAGE: 'INVALID_IMAGE', STATE_CHANGED: 'STATE_CHANGED',
  INPUT_LIMIT_EXCEEDED: 'JOB_LIMIT', PLANNING_LIMIT_EXCEEDED: 'JOB_LIMIT', GENERATION_FAILED: 'JOB_FAILED',
  PLANNING_FAILED: 'JOB_FAILED', LEASE_EXHAUSTED: 'JOB_FAILED', ATTEMPTS_EXHAUSTED: 'JOB_FAILED', LEASE_LOST: 'JOB_FAILED' };

interface LanguageRequest { query?: Record<string, unknown>; headers: Record<string, unknown> }
export function requestLanguage(request: LanguageRequest): string {
  const explicit = languageOf(request.query?.locale);
  if (explicit) return explicit;
  const header = request.headers['accept-language'];
  if (typeof header !== 'string') return 'en';
  const choices = header.slice(0, 2048).split(',').slice(0, 20).map((part) => {
    const [tag, weight] = part.trim().split(';');
    return { language: languageOf(tag), weight: weight === undefined ? 1 : Number(weight.trim().replace(/^q=/, '')) };
  }).filter((choice) => choice.language && choice.weight > 0 && choice.weight <= 1).sort((left, right) => right.weight - left.weight);
  return choices[0]?.language ?? 'en';
}

function languageOf(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const language = value.toLowerCase().split('-')[0];
  return LANGUAGES.includes(language) ? language : undefined;
}

function describeFeedback(code: FeedbackCode, locale: string) {
  return { code, locale, userMessage: feedbackText(code, locale), action: ACTIONS[code] ?? 'RETRY' };
}

export function localizeHttpError(status: number, message: unknown, requested: string) {
  const locale = languageOf(requested) ?? 'en';
  const messages: unknown[] = Array.isArray(message) ? message : [message];
  const hasPolicyChange = messages.some((item) => typeof item === 'string' && item.startsWith('attendanceRevision:'));
  const code = hasPolicyChange ? 'ATTENDANCE_CHANGED' : STATUS_CODES[status] ?? 'INTERNAL_ERROR';
  const details = status === 400 || status === 422 ? messages.slice(0, 100).map((item) => ({
    field: typeof item === 'string' ? /^([a-zA-Z][\w.[\]-]{0,79})(?::| (?:must|should|each value)\b)/u.exec(item)?.[1] ?? null : null,
    code: validationCode(item), userMessage: feedbackText(validationCode(item), locale),
  })) : [];
  return { ...describeFeedback(code, locale), details };
}

function validationCode(value: unknown): FeedbackCode {
  if (typeof value !== 'string') return 'INVALID_FIELD';
  const rules: [RegExp, FeedbackCode][] = [
    [/must be an email/, 'INVALID_EMAIL'], [/must be a string/, 'INVALID_STRING'],
    [/must be (?:an integer|a number)|must not be (?:less|greater) than/, 'INVALID_NUMBER'],
    [/must be (?:one of|a valid enum)|must match/, 'INVALID_CHOICE'],
    [/must be (?:shorter|longer)|must contain (?:at least|no more)|must not contain more/, 'INVALID_LENGTH'],
    [/should not be empty|is required|must be defined/, 'REQUIRED_FIELD'],
  ];
  return rules.find(([pattern]) => pattern.test(value))?.[1] ?? 'INVALID_FIELD';
}

export function localizeFailure(reason: unknown, requested: string, status?: unknown) {
  if (typeof reason !== 'string' || !reason) return null;
  let code = Object.hasOwn(JOB_CODES, reason) ? JOB_CODES[reason] : 'JOB_FAILED';
  if (code === 'STATE_CHANGED' && status === 'FAILED') code = 'JOB_FAILED';
  const result = describeFeedback(code, languageOf(requested) ?? 'en');
  if (['QUEUED', 'RUNNING', 'PROCESSING'].includes(String(status))) result.action = 'WAIT';
  return result;
}
