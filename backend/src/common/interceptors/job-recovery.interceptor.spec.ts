import { StreamableFile } from '@nestjs/common';
import { describeJobRecovery } from './job-recovery.interceptor';

it('localizes failed signature uploads as well as gallery pages and job lists', () => {
  const media = { failureReason: 'INVALID_IMAGE', processingStatus: 'FAILED' };
  const recovery = { code: 'INVALID_IMAGE', locale: 'fr', action: 'REUPLOAD' };
  expect(describeJobRecovery({ signatureUploads: [media], records: [] }, 'fr')).toMatchObject({ signatureUploads: [{ ...media, recovery }] });
  expect(describeJobRecovery({ items: [media] }, 'fr')).toMatchObject({ items: [{ ...media, recovery }] });
  expect(describeJobRecovery([{ failureReason: 'GENERATION_FAILED', status: 'QUEUED' }], 'hy')).toMatchObject([{ recovery: { locale: 'hy', action: 'WAIT' } }]);
  const stream = new StreamableFile(Buffer.from('private bytes'));
  expect(describeJobRecovery(stream, 'ru')).toBe(stream);
});

it.each(['hy', 'ru', 'fr', 'en'])('provides actionable export recovery in %s', (locale) => {
  const item = (failureReason: string, status = 'FAILED') => ({ failureReason, status });
  const failures = [item('INPUT_LIMIT_EXCEEDED'), item('OUTPUT_LIMIT_EXCEEDED'), item('ACCESS_REVOKED'),
    item('STORAGE_UNAVAILABLE', 'QUEUED'), item('STORAGE_UNAVAILABLE'), item('GENERATION_FAILED')];
  const result = describeJobRecovery(failures, locale);
  expect(result).toMatchObject(['CONTACT_SUPPORT', 'EDIT', 'REQUEST_ACCESS', 'WAIT', 'RETRY', 'RETRY']
    .map((action) => ({ recovery: { action, locale, userMessage: expect.any(String) } })));
});
