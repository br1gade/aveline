import { parseArgs } from 'node:util';
import { PrismaService } from './prisma/prisma.service';
import { requireReaderCompatibility } from './prisma/reader-compatibility';
import { recoverPayment, PaymentRecovery } from './modules/payments/payment-recovery';

/** Host-only, audited recovery; the normal reconciler decides what money moved. */
async function runRecovery(): Promise<void> {
  const { values } = parseArgs({ options: {
    'actor-user-id': { type: 'string' }, 'order-number': { type: 'string' }, action: { type: 'string' },
    'provider-ref': { type: 'string' }, reason: { type: 'string' }, 'evidence-ref': { type: 'string' },
    'invoice-id': { type: 'string' }, 'ticket-order-id': { type: 'string' },
  } });
  const prisma = new PrismaService();
  try {
    await requireReaderCompatibility(prisma);
    await recoverPayment(prisma, { actorUserId: values['actor-user-id'] ?? '', orderNumber: values['order-number'] ?? '',
      action: (values.action ?? '') as PaymentRecovery['action'], providerRef: values['provider-ref'],
      reason: values.reason ?? '', evidenceRef: values['evidence-ref'] ?? '',
      invoiceId: values['invoice-id'], ticketOrderId: values['ticket-order-id'] });
    process.stdout.write('Recovery evidence recorded. Bank reconciliation remains authoritative.\n');
  } finally { await prisma.$disconnect(); }
}

void runRecovery().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : 'Payment recovery failed'}\n`);
  process.exitCode = 1;
});
