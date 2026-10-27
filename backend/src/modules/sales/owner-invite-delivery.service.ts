import { Injectable, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CommunicationsService } from '../communications/communications.service';
import { lockIntake } from './enquiry-lock';

@Injectable()
export class OwnerInviteDeliveryService implements OnModuleInit {
  constructor(private readonly prisma: PrismaService, private readonly communications: CommunicationsService) {}

  onModuleInit(): void {
    this.communications.checkBeforeSending('organization.invite', async (message) => {
      if (!message.id) return false;
      return this.canSend(message.id);
    });
  }

  canSend(messageId: string): Promise<boolean> {
    return this.prisma.$transaction(async (tx) => {
      await lockIntake(tx);
      const message = await tx.message.findUnique({ where: { id: messageId }, select: { dedupeKey: true, toAddress: true } });
      if (!message?.dedupeKey?.startsWith('organization.invite:')) return false;
      const invitation = await tx.organizationInvite.findFirst({ where: { tokenHash: message.dedupeKey.slice('organization.invite:'.length), email: message.toAddress, acceptedAt: null, revokedAt: null, expiresAt: { gt: new Date() }, organization: { deletedAt: null } }, select: { id: true } });
      if (!invitation) return false;
      const delivery = await tx.ownerInviteDelivery.findUnique({ where: { organizationInviteId: invitation.id }, select: { messageId: true, state: true, sourceContactId: true, enquiry: { select: { clearanceReason: true } } } });
      if (!delivery) return true;
      return delivery.messageId === messageId && delivery.state === 'QUEUED' && !(delivery.sourceContactId && delivery.enquiry?.clearanceReason === 'VERIFIED_ERASURE');
    });
  }

  async repair(): Promise<number> {
    const deliveries = await this.prisma.ownerInviteDelivery.findMany({ where: { state: { in: ['PENDING', 'QUEUED'] } }, orderBy: { createdAt: 'asc' }, take: 100, select: { id: true, organizationInviteId: true, messageId: true } });
    if (!deliveries.length) return 0;
    const [messages, invites] = await Promise.all([
      this.prisma.message.findMany({ where: { id: { in: deliveries.flatMap((delivery) => delivery.messageId ? [delivery.messageId] : []) } }, select: { id: true, status: true } }),
      this.prisma.organizationInvite.findMany({ where: { id: { in: deliveries.map((delivery) => delivery.organizationInviteId) }, acceptedAt: null, revokedAt: null, expiresAt: { gt: new Date() } }, select: { id: true } }),
    ]);
    const messageIds = new Set(messages.filter((message) => message.status !== 'FAILED').map((message) => message.id));
    const invitationIds = new Set(invites.map((invite) => invite.id));
    const cancelled = deliveries.filter((delivery) => !invitationIds.has(delivery.organizationInviteId)).map((delivery) => delivery.id);
    const review = deliveries.filter((delivery) => invitationIds.has(delivery.organizationInviteId) && (!delivery.messageId || !messageIds.has(delivery.messageId))).map((delivery) => delivery.id);
    await this.prisma.$transaction([
      this.prisma.ownerInviteDelivery.updateMany({ where: { id: { in: cancelled }, state: { in: ['PENDING', 'QUEUED'] } }, data: { state: 'CANCELLED' } }),
      this.prisma.ownerInviteDelivery.updateMany({ where: { id: { in: review }, state: { in: ['PENDING', 'QUEUED'] } }, data: { state: 'NEEDS_REVIEW' } }),
    ]);
    return cancelled.length + review.length;
  }
}
