import { localizeFailure, localizeHttpError, requestLanguage } from './localized-feedback';

describe('User-facing validation and recovery copy', () => {
  it.each(['en', 'ru', 'fr', 'hy'])('returns field-addressable validation and policy recovery in %s', (locale) => {
    const validation = localizeHttpError(400, ['members.0.firstName must be a string', 'venueAttendance: choose a venue'], locale);
    expect(validation.locale).toBe(locale);
    expect(validation.details.map((detail) => detail.field)).toEqual(['members.0.firstName', 'venueAttendance']);
    expect(validation.userMessage).toBeTruthy();
    expect(localizeHttpError(409, 'attendanceRevision: attendance policy changed; reload', locale)).toMatchObject({ code: 'ATTENDANCE_CHANGED', action: 'RELOAD' });
    expect(localizeFailure('STATE_CHANGED', locale)).toMatchObject({ locale, action: 'WAIT' });
    expect(localizeFailure('SUBJECT_ERASED', locale)).toMatchObject({ locale, action: 'REGENERATE' });
  });
  it('names an unknown property, top-level or nested, by its path', () => {
    const result = localizeHttpError(400, ['property isAdmin should not exist', 'organization.create.property role should not exist', 'property a b should not exist'], 'en');
    expect(result.details.map((detail) => detail.field)).toEqual(['isAdmin', 'organization.create.role', null]);
  });
  it('names the field of a per-item and a nested-object rule, top-level or nested', () => {
    const result = localizeHttpError(400, ['each value in labels must be a string', 'items.0.each value in tags must be a string',
      'nested property venue must be either object or array', 'each value in nested property items must be either object or array'], 'en');
    expect(result.details.map((detail) => detail.field)).toEqual(['labels', 'items.0.tags', 'venue', 'items']);
  });
  it('honors language weights and region tags and bounds unsupported input', () => {
    expect(requestLanguage({ headers: { 'accept-language': 'de;q=1, fr-CA;q=0.8, ru;q=0.5' } })).toBe('fr');
    expect(requestLanguage({ query: { locale: 'hy-AM' }, headers: {} })).toBe('hy');
    expect(requestLanguage({ headers: { 'accept-language': 'ru;q=0, en;q=0.5' } })).toBe('en');
    expect(requestLanguage({ query: { locale: ['fr', 'ru'] }, headers: {} })).toBe('en');
  });
  it('does not echo private error contents into translated display text', () => {
    const result = localizeHttpError(404, 'Guest private@example.test not found', 'fr');
    expect(JSON.stringify(result)).not.toContain('private@example.test');
    expect(localizeFailure('unrecognized internal failure', 'ru')).toMatchObject({ code: 'JOB_FAILED', action: 'RETRY' });
    expect(localizeFailure(null, 'en')).toBeNull();
  });
  it('does not promise an automatic retry after seating state-change retries are exhausted', () => {
    expect(localizeFailure('STATE_CHANGED', 'fr', 'FAILED')).toMatchObject({ code: 'JOB_FAILED', action: 'RETRY' });
    expect(localizeFailure('STATE_CHANGED', 'fr', 'QUEUED')).toMatchObject({ code: 'STATE_CHANGED', action: 'WAIT' });
  });
});
