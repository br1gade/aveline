import { PrismaClient } from '@prisma/client';
import { PrismaService } from '../../src/prisma/prisma.service';
import { PromoCodesService } from '../../src/modules/billing/promo-codes.service';
import { PaymentGatewayRegistry } from '../../src/modules/payments/payment-gateway.registry';
import { PaymentsService } from '../../src/modules/payments/payments.service';
import { FakeGateway } from '../../src/modules/payments/providers/fake.gateway';
import { TicketFulfilmentService } from '../../src/modules/ticketing/ticket-fulfilment.service';
import { TicketInventoryService } from '../../src/modules/ticketing/ticket-inventory.service';
import { TicketNotifierService } from '../../src/modules/ticketing/ticket-notifier.service';
import { TicketingService } from '../../src/modules/ticketing/ticketing.service';
import { TicketCancellationService } from '../../src/modules/ticketing/ticket-cancellation.service';
import { seedEvent } from './event.fixture';

export function ticketServices(prisma: PrismaClient) {
  const database = prisma as unknown as PrismaService;
  const fake = new FakeGateway();
  const payments = new PaymentsService(database, new PaymentGatewayRegistry([fake]));
  const inventory = new TicketInventoryService(database);
  const promos = new PromoCodesService(database);
  const notices = { sendTickets: jest.fn().mockResolvedValue(undefined), sendCancellation: jest.fn().mockResolvedValue(undefined) };
  const fulfilment = new TicketFulfilmentService(database, inventory, promos, notices as unknown as TicketNotifierService);
  return { fake, payments, inventory, fulfilment, ticketing: new TicketingService(database, payments, promos, fulfilment),
    cancellation: new TicketCancellationService(database, payments, fulfilment) };
}

export async function ticketEvent(prisma: PrismaClient) {
  const event = await seedEvent(prisma);
  await prisma.event.update({ where: { id: event.eventId }, data: { visibility: 'PUBLIC' } });
  const listing = await prisma.eventListing.create({ data: { eventId: event.eventId, slug: `sale-${event.eventId}`, publishedAt: new Date() } });
  const type = await prisma.ticketType.create({ data: { eventId: event.eventId, name: { en: 'Entry' }, priceMinor: 0n, quantityTotal: 500, maxPerOrder: 100 } });
  return { ...event, slug: listing.slug, invitationSlug: event.slug, ticketTypeId: type.id };
}

export function attendeeRoster(ticketTypeId: string, quantity: number) {
  return Array.from({ length: quantity }, (_, index) => ({ ticketTypeId, firstName: `Attendee ${index + 1}` }));
}
