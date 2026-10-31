import { BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { lockOrganizationStanding } from '../../infra/auth/access-locks';
import { resolveCustomerOrganizations, selectionRequired } from '../../infra/auth/organization-context';
import { EventsService } from '../events/events.service';
import { ConvertEnquiryDto } from './dto/enquiry-conversion.dto';

export interface ConversionTarget {
  organizationId: string | null;
  eventId: string | null;
  prepared?: Awaited<ReturnType<EventsService['prepareCreation']>>;
}

export function validateConversionTarget(dto: ConvertEnquiryDto): void {
  if (Boolean(dto.organization.existingId) === Boolean(dto.organization.create)) throw new BadRequestException('organization: requires exactly one existingId or create');
  if (dto.event && Boolean(dto.event.existingId) === Boolean(dto.event.create)) throw new BadRequestException('event: requires exactly one existingId or create');
  if (dto.organization.create && dto.event?.existingId) throw new BadRequestException('event.existingId: requires organization.existingId');
}

export async function resolveConversionTarget(tx: Prisma.TransactionClient, dto: ConvertEnquiryDto, events: EventsService): Promise<ConversionTarget> {
  const organizationId = await resolveTargetOrganization(tx, dto);
  if (organizationId) await lockOrganizationStanding(tx, { organizationId, mode: 'update' });
  if (organizationId && dto.organization.create) await tx.$queryRaw`SELECT id FROM organization_invites WHERE "organizationId"=${organizationId} AND email=${dto.organization.create.ownerEmail.trim().toLowerCase()} FOR UPDATE`;
  const prepared = dto.event?.create ? await events.prepareCreation(tx, { organizationId: organizationId ?? '', dto: dto.event.create }) : undefined;
  const eventId = dto.event?.existingId ?? null;
  if (eventId) await lockDraftEvent(tx, { eventId, organizationId });
  return { organizationId, eventId, prepared };
}

async function resolveTargetOrganization(tx: Prisma.TransactionClient, dto: ConvertEnquiryDto): Promise<string | null> {
  let organizationId = dto.organization.existingId ?? null;
  if (dto.organization.create) {
    const ownerEmail = dto.organization.create.ownerEmail.trim().toLowerCase();
    const resolved = await resolveCustomerOrganizations(tx, { ownerEmail });
    if (resolved.kind === 'selection-required') throw selectionRequired();
    if (resolved.kind === 'one') organizationId = resolved.organizationId;
    if (resolved.kind === 'none' && await tx.organizationInvite.count({ where: { email: ownerEmail, role: 'OWNER', acceptedAt: null, revokedAt: null, organization: { deletedAt: null } } })) throw selectionRequired();
  }
  return organizationId;
}

async function lockDraftEvent(tx: Prisma.TransactionClient, target: { eventId: string; organizationId: string | null }): Promise<void> {
  const rows = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM events WHERE id=${target.eventId} AND "organizationId"=${target.organizationId} AND status='DRAFT' FOR UPDATE`;
  if (!rows.length) throw new BadRequestException('event.existingId must be a DRAFT event in the selected organization');
  await tx.$queryRaw`SELECT id FROM invitations WHERE "eventId"=${target.eventId} FOR UPDATE`;
}
