import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { EventRole, EventStatus, Prisma } from '@prisma/client';
import { randomBytes } from 'node:crypto';
import { AuditService } from '../../infra/audit/audit.service';
import { PrismaService } from '../../prisma/prisma.service';
import { defaultBlocksFor } from './default-blocks';
import { CreateEventDto } from './dto/create-event.dto';
import { invitationSlug } from './invitation-slug';

@Injectable()
export class EventsService {
  private readonly logger = new Logger(EventsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /**
   * Who changed what on one event.
   *
   * Requires `member:manage` rather than `event:read`: the trail exists partly
   * to hold Aveline's own SUPPORT staff accountable when they act on a
   * customer's behalf, and it names the people who did things.
   */
  async auditTrail(eventId: string) {
    await this.findOne(eventId);
    return this.audit.forEvent(eventId);
  }

  /**
   * Creates an event, its draft invitation, and the caller's ownership of it.
   *
   * All three in one request because they are one intent: nothing can be done
   * with an event that has no invitation, and an event nobody owns is
   * unreachable the moment the request ends. Until this existed, events could
   * only be made by the seed script — so a real customer could register,
   * create an organization, and then stop.
   *
   * One transaction, because a half-created event is worse than none: an event
   * with no membership cannot be read back to be fixed.
   */
  async create(organizationId: string, userId: string, dto: CreateEventDto) {
    // An authenticated account with no organization has nowhere to put an
    // event. Without this the insert fails on a foreign key and the host is
    // shown a database error instead of the one thing they need to do next.
    if (!organizationId) {
      throw new ForbiddenException(
        'Create your organization first with POST /organizations, then create an event in it',
      );
    }

    const startsAt = new Date(dto.startsAt);
    const endsAt = dto.endsAt ? new Date(dto.endsAt) : null;

    if (endsAt && endsAt <= startsAt) {
      throw new BadRequestException('endsAt must be after startsAt');
    }

    const template = await this.pickTemplate(dto.templateKey);
    const hostsLabel = dto.hostsLabel ?? dto.title;

    const event = await this.prisma.$transaction(async (tx) => {
      const created = await tx.event.create({
        data: {
          organizationId,
          type: dto.type,
          title: dto.title,
          hostsLabel,
          startsAt,
          endsAt,
          timezone: dto.timezone ?? 'Asia/Yerevan',
          locales: dto.locales ?? ['hy'],
          defaultLocale: dto.defaultLocale ?? dto.locales?.[0] ?? 'hy',
          sideALabel: dto.sideALabel ?? null,
          sideBLabel: dto.sideBLabel ?? null,
          visibility: dto.visibility ?? undefined,
          status: EventStatus.DRAFT,
        },
      });

      // The creator owns it. Without this the event exists and its creator
      // cannot read it back, because the guard resolves access from membership.
      await tx.eventMembership.create({
        data: { eventId: created.id, userId, role: EventRole.OWNER },
      });

      if (template) {
        await tx.invitation.create({
          data: {
            eventId: created.id,
            slug: invitationSlug(hostsLabel, randomBytes(4).toString('hex')),
            templateId: template.id,
            theme: template.defaultTheme as Prisma.InputJsonValue,
            // Without these the host opens a blank page and can publish it.
            blocks: { create: defaultBlocksFor(template.supportedBlocks) },
          },
        });
      }

      return created;
    });

    this.logger.log(`event ${event.id} created in organization ${organizationId}`);
    return this.findOne(event.id);
  }

  /**
   * Adds the invitation to an event that has none.
   *
   * Only reachable when the platform had no active template at creation time,
   * which is a state a new deployment passes through. Separate rather than
   * folded into `create` so that case is recoverable without deleting the
   * event.
   */
  async createInvitation(eventId: string, templateKey?: string) {
    const event = await this.prisma.event.findUnique({
      where: { id: eventId },
      select: { id: true, hostsLabel: true, invitation: { select: { slug: true } } },
    });
    if (!event) throw new NotFoundException(`No event ${eventId}`);
    if (event.invitation) {
      throw new BadRequestException(
        `This event already has an invitation at "${event.invitation.slug}"`,
      );
    }

    const template = await this.pickTemplate(templateKey);
    if (!template) {
      throw new BadRequestException('No design template is available to build an invitation from');
    }

    return this.prisma.invitation.create({
      data: {
        eventId,
        slug: invitationSlug(event.hostsLabel, randomBytes(4).toString('hex')),
        templateId: template.id,
        theme: template.defaultTheme as Prisma.InputJsonValue,
        blocks: { create: defaultBlocksFor(template.supportedBlocks) },
      },
      select: { slug: true, status: true, template: { select: { key: true } } },
    });
  }

  /**
   * The named template, or whichever is first when none was named.
   *
   * Defaulting rather than demanding one: a host creating their first event has
   * not seen the catalogue yet, and an event with a draft invitation they can
   * restyle is more useful than a form that refuses to submit.
   */
  private async pickTemplate(templateKey?: string) {
    if (templateKey) {
      const named = await this.prisma.designTemplate.findFirst({
        where: { key: templateKey, isActive: true },
      });
      if (!named) throw new NotFoundException(`No template "${templateKey}" is available`);
      return named;
    }

    return this.prisma.designTemplate.findFirst({
      where: { isActive: true },
      orderBy: { name: 'asc' },
    });
  }

  findAll(organizationId?: string) {
    return this.prisma.event.findMany({
      where: organizationId ? { organizationId } : undefined,
      include: { invitation: { select: { slug: true, status: true } }, _count: { select: { guests: true } } },
      orderBy: { startsAt: 'asc' },
    });
  }

  async findOne(id: string) {
    const event = await this.prisma.event.findUnique({
      where: { id },
      include: {
        venues: { orderBy: { sortOrder: 'asc' } },
        timeline: { orderBy: { occursAt: 'asc' } },
        invitation: true,
        _count: { select: { guests: true, households: true, tables: true } },
      },
    });
    if (!event) throw new NotFoundException(`No event ${id}`);
    return event;
  }
  /**
   * Changes the settings a host can reasonably flip themselves.
   *
   * Deliberately narrow: this is not a general event PATCH. Title, date and
   * venue changes affect an invitation people already hold, so they belong
   * with the flows that know how to tell those guests — not in a settings
   * toggle.
   */
  async updateSettings(eventId: string, settings: { remindersEnabled?: boolean }) {
    await this.findOne(eventId);

    const updated = await this.prisma.event.update({
      where: { id: eventId },
      data: { remindersEnabled: settings.remindersEnabled ?? undefined },
      select: { id: true, remindersEnabled: true },
    });
    return updated;
  }

}