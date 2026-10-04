import { Injectable, NotFoundException } from '@nestjs/common';
import { PaymentProvider } from '@prisma/client';
import { PaymentGateway } from './providers/payment-provider';

/**
 * Resolves a provider enum to its adapter. A lookup, not a switch, so adding
 * a bank is registering one more gateway.
 */
@Injectable()
export class PaymentGatewayRegistry {
  private readonly gateways = new Map<PaymentProvider, PaymentGateway>();

  constructor(gateways: PaymentGateway[]) {
    for (const gateway of gateways) this.gateways.set(gateway.provider, gateway);
  }

  get(provider: PaymentProvider): PaymentGateway {
    const gateway = this.gateways.get(provider);
    if (!gateway) {
      throw new NotFoundException(
        `${provider} is not configured. Set its credentials to enable it.`,
      );
    }
    return gateway;
  }

  configured(): PaymentProvider[] {
    return [...this.gateways.keys()];
  }
}
