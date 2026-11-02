import { ArgumentsHost, HttpException } from '@nestjs/common';
import { DomainHttpException } from '../domain-http.exception';
import { AllExceptionsFilter } from './all-exceptions.filter';

function catchResponse(exception: unknown, locale: string) {
  const json = jest.fn();
  const response = { status: jest.fn().mockReturnValue({ json }) };
  const host = { switchToHttp: () => ({ getResponse: () => response, getRequest: () => ({ headers: { 'accept-language': locale }, url: '/api/v1/subscription', method: 'GET', requestId: 'test' }) }) };
  new AllExceptionsFilter().catch(exception, host as ArgumentsHost);
  return json.mock.calls[0][0] as { statusCode: number; code: string; action: string; locale: string; userMessage: string; details: unknown[] };
}

describe('safe domain feedback boundary', () => {
  it.each(['en', 'ru', 'fr', 'hy'])('preserves a localized selection action in %s', (locale) => {
    expect(catchResponse(new DomainHttpException('ORGANIZATION_SELECTION_REQUIRED', 'organizationId: select an organization'), locale)).toMatchObject({
      statusCode: 409, code: 'ORGANIZATION_SELECTION_REQUIRED', action: 'SELECT_ORGANIZATION', locale, details: [],
    });
  });
  it('discards arbitrary exception code/action fields', () => {
    expect(catchResponse(new HttpException({ message: 'changed', code: 'UNTRUSTED', action: 'SEND_SECRET' }, 409), 'en')).toMatchObject({ code: 'CONFLICT', action: 'RELOAD' });
  });
  it('uses distinct translated copy in all four supported languages', () => {
    expect(new Set(['en', 'ru', 'fr', 'hy'].map((locale) => catchResponse(new DomainHttpException('OWNER_HANDOVER_REQUIRED', 'handover'), locale).userMessage)).size).toBe(4);
  });
});

describe('localized template feedback', () => {
  it.each(['en', 'ru', 'fr', 'hy'])('keeps a safe stale-preview code and regeneration action in %s', (locale) => {
    expect(catchResponse(new DomainHttpException('TEMPLATE_PREVIEW_STALE', 'The preview is stale'), locale)).toMatchObject({ statusCode: 409, code: 'TEMPLATE_PREVIEW_STALE', action: 'REGENERATE', locale });
  });
  it('identifies nested template field errors while retaining distinct translations', () => {
    const results = ['en', 'ru', 'fr', 'hy'].map((locale) => catchResponse(new DomainHttpException('TEMPLATE_VALIDATION_FAILED', ['blockVariants.HERO: unsupported variant']), locale));
    expect(results.every((result) => result.details.length === 1)).toBe(true);
    expect(new Set(results.map((result) => result.userMessage)).size).toBe(4);
  });
});
