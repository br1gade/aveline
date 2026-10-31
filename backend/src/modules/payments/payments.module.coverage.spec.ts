import { Global, Logger, Module, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { PaymentProvider } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { PaymentGatewayRegistry } from './payment-gateway.registry';
import { PaymentsModule } from './payments.module';

/**
 * The fake gateway mints "paid" orders on request, so which providers the
 * module registers is a production safety property (docs/PAYMENTS.md §4,
 * "Local development"), not a convenience.
 */
describe('PaymentsModule provider registration', () => {
  /** The registry the module builds from exactly these configuration values. */
  const registryFor = async (values: Record<string, string>) => {
    @Global()
    @Module({
      providers: [
        { provide: ConfigService, useValue: { get: (key: string) => values[key] } },
        { provide: PrismaService, useValue: {} },
      ],
      exports: [ConfigService, PrismaService],
    })
    class EnvironmentModule {}

    const moduleRef = await Test.createTestingModule({ imports: [EnvironmentModule, PaymentsModule] }).compile();
    return moduleRef.get(PaymentGatewayRegistry);
  };

  beforeEach(() => {
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  });
  afterEach(() => jest.restoreAllMocks());

  it('never registers the fake gateway in production', async () => {
    const registry = await registryFor({ NODE_ENV: 'production' });

    expect(registry.configured()).not.toContain(PaymentProvider.FAKE);
    expect(() => registry.get(PaymentProvider.FAKE)).toThrow(NotFoundException);
  });

  it('keeps the fake gateway out of production even beside a configured bank', async () => {
    const registry = await registryFor({ NODE_ENV: 'production', AMERIA_USERNAME: 'merchant' });

    expect(registry.configured()).toEqual([PaymentProvider.AMERIABANK]);
  });

  it.each([{ NODE_ENV: undefined }, { NODE_ENV: 'staging' }])('treats NODE_ENV $NODE_ENV as production', async ({ NODE_ENV }) => {
    const registry = await registryFor(NODE_ENV === undefined ? {} : { NODE_ENV });

    expect(registry.configured()).not.toContain(PaymentProvider.FAKE);
  });

  it.each(['development', 'test'])('registers the fake gateway when NODE_ENV is %s', async (nodeEnv) => {
    const registry = await registryFor({ NODE_ENV: nodeEnv });

    expect(registry.configured()).toEqual([PaymentProvider.FAKE]);
  });

  it.each([
    { credentialKey: 'AMERIA_USERNAME', provider: PaymentProvider.AMERIABANK },
    { credentialKey: 'INECO_USERNAME', provider: PaymentProvider.INECOBANK },
    { credentialKey: 'IDBANK_USERNAME', provider: PaymentProvider.IDBANK },
  ])('registers $provider only when $credentialKey is set', async ({ credentialKey, provider }) => {
    const without = await registryFor({ NODE_ENV: 'production' });
    const configured = await registryFor({ NODE_ENV: 'production', [credentialKey]: 'merchant' });

    expect(without.configured()).not.toContain(provider);
    expect(configured.configured()).toEqual([provider]);
    expect(configured.get(provider).provider).toBe(provider);
  });
});
