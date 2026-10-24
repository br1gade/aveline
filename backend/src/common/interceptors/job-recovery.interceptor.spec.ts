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
