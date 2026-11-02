import { validateEnv } from '../../common/env.validation';

describe('closed intake deployment surface', () => {
  const base = { NODE_ENV: 'test', DATABASE_URL: 'postgresql://example' };
  it.each(['SALES_INTAKE_ENABLED', 'SALES_INTAKE_SUPPORT_ENABLED', 'SALES_ENQUIRY_CONVERSION_ENABLED', 'SALES_ENQUIRY_RETENTION_DRY_RUN'])('rejects malformed %s', (flag) => {
    expect(() => validateEnv({ ...base, [flag]: 'yes' })).toThrow(flag);
  });
  it('requires durable privacy configuration before enabling contacts', () => {
    expect(() => validateEnv({ ...base, SALES_INTAKE_ENABLED: 'true' })).toThrow('SALES_INTENT_HMAC');
  });
});
