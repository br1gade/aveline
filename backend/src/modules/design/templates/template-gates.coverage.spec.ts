import { ConfigService } from '@nestjs/config';
import { TemplateGatesService } from './template-gates.service';

/** template-gates.service.ts: each template rollout gate opens only on the exact string 'true'. */
const FEATURES = ['AUTHORING', 'ASSETS', 'ADOPTION', 'PUBLISH'] as const;
const gates = (values: Record<string, string>) => new TemplateGatesService(new ConfigService(values));

describe('template rollout gates', () => {
  // ConfigService falls back to process.env for keys it was not given; an exported flag must not decide these cases.
  beforeEach(() => {
    const flags = new Set(FEATURES.map((feature) => `TEMPLATE_${feature}_ENABLED`));
    jest.replaceProperty(process, 'env', Object.fromEntries(Object.entries(process.env).filter(([key]) => !flags.has(key))));
  });
  afterEach(() => jest.restoreAllMocks());

  it.each(FEATURES.flatMap((feature) => [undefined, 'false', 'TRUE', '1'].map((value) => ({ feature, value }))))(
    'closes $feature when its flag is $value',
    ({ feature, value }) => {
      const service = gates(value === undefined ? {} : { [`TEMPLATE_${feature}_ENABLED`]: value });
      expect(() => service.require(feature)).toThrow(expect.objectContaining({ code: 'TEMPLATE_FEATURE_DISABLED', status: 503 }) as Error);
    },
  );

  it.each(FEATURES)('opens only %s when its own flag is true', (feature) => {
    const service = gates({ [`TEMPLATE_${feature}_ENABLED`]: 'true' });
    expect(() => service.require(feature)).not.toThrow();
    for (const other of FEATURES.filter((entry) => entry !== feature)) expect(() => service.require(other)).toThrow(`${other.toLowerCase()} is not enabled`);
  });

  it('reports publication as closed unless the publish flag is true', () => {
    expect(gates({}).canPublish()).toBe(false);
    expect(gates({ TEMPLATE_PUBLISH_ENABLED: 'true' }).canPublish()).toBe(true);
  });
});
