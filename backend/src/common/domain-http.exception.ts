import { HttpException } from '@nestjs/common';

export const DOMAIN_ERRORS = {
  ENQUIRY_CHANGED: { status: 409, action: 'RELOAD' },
  CONSULTATION_CONFLICT: { status: 409, action: 'EDIT' },
  IDEMPOTENCY_CONFLICT: { status: 409, action: 'RELOAD' },
  SUBJECT_ERASED: { status: 409, action: 'CONTACT_SUPPORT' },
  NO_CHANGE: { status: 409, action: 'EDIT' },
  TEMPLATE_VALIDATION_FAILED: { status: 400, action: 'EDIT' },
  TEMPLATE_CAPABILITY_REQUIRED: { status: 409, action: 'CONTACT_SUPPORT' },
  TEMPLATE_STATE_CHANGED: { status: 409, action: 'RELOAD' },
  TEMPLATE_ACCESS_DENIED: { status: 403, action: 'REQUEST_ACCESS' },
  TEMPLATE_PREVIEW_UNAVAILABLE: { status: 409, action: 'REGENERATE' },
  TEMPLATE_NOT_FOUND: { status: 404, action: 'CONTACT_HOST' },
  ORGANIZATION_SELECTION_REQUIRED: { status: 409, action: 'SELECT_ORGANIZATION' },
  ORGANIZATION_CONTEXT_MISMATCH: { status: 409, action: 'SELECT_ORGANIZATION' },
  ORGANIZATION_ACCESS_DENIED: { status: 403, action: 'REQUEST_ACCESS' },
  OWNER_HANDOVER_REQUIRED: { status: 409, action: 'HAND_OVER_OWNERSHIP' },
  IDEMPOTENCY_KEY_REUSED: { status: 409, action: 'RELOAD' },
  REVISION_CHANGED: { status: 409, action: 'RELOAD' },
} as const;
export type DomainErrorCode = keyof typeof DOMAIN_ERRORS;

/** Only application-owned codes cross the global feedback boundary. */
export class DomainHttpException extends HttpException {
  constructor(readonly code: DomainErrorCode, message: string) {
    super({ message }, DOMAIN_ERRORS[code].status);
  }
}
