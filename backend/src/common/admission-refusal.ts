import { DomainHttpException, type DomainErrorCode } from './domain-http.exception';
import type { AdmissionFeedbackDto } from './feedback.dto';

type AdmissionCode = Extract<DomainErrorCode, `ADMISSION_${string}`
  | 'TICKET_ALREADY_USED' | 'TICKET_ORDER_UNAVAILABLE' | 'TICKET_STATUS_UNAVAILABLE' | 'TICKET_ATTENDEE_REQUIRED'>;

export class AdmissionRefusal extends DomainHttpException {
  constructor(code: AdmissionCode, message: string, readonly admission?: AdmissionFeedbackDto) {
    super(code, message);
  }
}
