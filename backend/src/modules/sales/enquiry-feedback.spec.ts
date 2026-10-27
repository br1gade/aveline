import { DomainHttpException } from '../../common/domain-http.exception';
import { localizeHttpError } from '../../common/localized-feedback';

describe('safe enquiry feedback', () => {
  it.each(['en', 'ru', 'fr', 'hy'])('localizes each conflict in %s', (locale) => {
    for (const code of ['ENQUIRY_CHANGED', 'CONSULTATION_CONFLICT', 'IDEMPOTENCY_CONFLICT', 'SUBJECT_ERASED', 'NO_CHANGE'] as const) {
      const error = new DomainHttpException(code, code);
      expect(localizeHttpError(409, error.message, locale, code)).toMatchObject({ code, locale });
      expect(localizeHttpError(409, error.message, locale, code).userMessage).not.toBe(code);
    }
  });
});
