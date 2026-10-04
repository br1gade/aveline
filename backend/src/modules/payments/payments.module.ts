import { Logger, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PaymentProvider } from '@prisma/client';
import { PaymentGatewayRegistry } from './payment-gateway.registry';
import { PaymentsController } from './payments.controller';
import { PaymentsService } from './payments.service';
import { AmeriabankGateway } from './providers/ameriabank.gateway';
import { ArcaGateway } from './providers/arca.gateway';
import { FakeGateway } from './providers/fake.gateway';
import { PaymentGateway } from './providers/payment-provider';

/**
 * Each bank declares how to build itself from configuration. A table rather
 * than a chain of ifs, so adding a provider is adding a row.
 */
interface GatewaySpec {
  /** Presence of this variable is what enables the provider. */
  credentialKey: string;
  build: (config: ConfigService) => PaymentGateway;
}

const GATEWAY_SPECS: GatewaySpec[] = [
  {
    credentialKey: 'AMERIA_USERNAME',
    build: (config) =>
      new AmeriabankGateway({
        baseUrl: config.get<string>('AMERIA_BASE_URL') ?? 'https://servicestest.ameriabank.am',
        clientId: config.get<string>('AMERIA_CLIENT_ID') ?? '',
        username: config.get<string>('AMERIA_USERNAME') ?? '',
        password: config.get<string>('AMERIA_PASSWORD') ?? '',
      }),
  },
  {
    credentialKey: 'INECO_USERNAME',
    build: (config) =>
      new ArcaGateway(PaymentProvider.INECOBANK, {
        baseUrl: config.get<string>('INECO_BASE_URL') ?? 'https://ipaytest.inecobank.am',
        username: config.get<string>('INECO_USERNAME') ?? '',
        password: config.get<string>('INECO_PASSWORD') ?? '',
      }),
  },
  {
    credentialKey: 'IDBANK_USERNAME',
    build: (config) =>
      new ArcaGateway(PaymentProvider.IDBANK, {
        baseUrl: config.get<string>('IDBANK_BASE_URL') ?? 'https://ipayproxy.idp.am',
        username: config.get<string>('IDBANK_USERNAME') ?? '',
        password: config.get<string>('IDBANK_PASSWORD') ?? '',
      }),
  },
];

/**
 * Only providers with credentials configured are registered, so a missing
 * bank reads as "not configured" rather than surfacing as a confusing auth
 * failure at the moment a customer tries to pay.
 */
function buildGateways(config: ConfigService): PaymentGateway[] {
  const logger = new Logger('PaymentsModule');

  const gateways = GATEWAY_SPECS.filter((spec) => config.get<string>(spec.credentialKey)).map(
    (spec) => spec.build(config),
  );

  // The fake gateway would let anyone mint a "paid" order, so production
  // refuses it outright rather than trusting configuration to be right.
  if (config.get<string>('NODE_ENV') !== 'production') {
    gateways.push(new FakeGateway());
  }

  if (gateways.length === 0) {
    logger.warn('No payment provider is configured; payment endpoints will reject every request.');
  } else {
    logger.log(`Payment providers configured: ${gateways.map((g) => g.provider).join(', ')}`);
  }

  return gateways;
}

@Module({
  controllers: [PaymentsController],
  providers: [
    {
      provide: PaymentGatewayRegistry,
      inject: [ConfigService],
      useFactory: (config: ConfigService) => new PaymentGatewayRegistry(buildGateways(config)),
    },
    PaymentsService,
  ],
  exports: [PaymentsService, PaymentGatewayRegistry],
})
export class PaymentsModule {}
