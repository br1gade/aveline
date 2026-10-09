import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { EventRole, EventStatus, EventVisibility, PlatformRole, Prisma } from '@prisma/client';
import { randomBytes } from 'node:crypto';
import { AuditService } from '../../infra/audit/audit.service';
import { RequestActor, actorCan } from '../../infra/auth/actor';
import { CacheService } from '../../infra/cache/cache.service';
import { countInvitedHouseholds } from '../invitations/sending/audience';
import { PrismaService } from '../../prisma/prisma.service';
import { defaultBlocksFor } from './default-blocks';
import { CreateEventDto } from './dto/create-event.dto';
import { UpdateEventDto } from './dto/update-event.dto';
import { EventDetails, NOTICE_WORTHY, changedFields, detailsProblem } from './event-details';
import { EVENT_TRANSLATABLE, translationsProblem } from '../../common/field-translations';
import { mergeTranslations } from '../design/translated-content';
import { invitationSlug } from './invitation-slug';

@Injectable()
export class EventsService {
  private readonly logger = new Logger(EventsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly cache: CacheService,
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
    const locales = dto.locales ?? ['hy'];
    const timezone = dto.timezone ?? 'Asia/Yerevan';
    const defaultLocale = dto.defaultLocale ?? locales[0];

    const problem = detailsProblem({ startsAt, endsAt, timezone, locales, defaultLocale });
    if (problem) throw new BadRequestException(problem);

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
          timezone,
          locales,
          defaultLocale,
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

  /**
   * The events this caller can reach: their organization's, if their role
   * there lets them read events, and any they were brought onto directly.
   * Someone invited to one event only — a venue's door staff — sees that event
   * and nothing else. Platform staff see everything.
   */
  findAll(actor: RequestActor) {
    const reach: Prisma.EventWhereInput[] = [{ memberships: { some: { userId: actor.userId } } }];
    if (actor.organizationId && actorCan(actor, 'event:read')) reach.push({ organizationId: actor.organizationId });
    const isStaff = actor.platformRole !== PlatformRole.NONE;

    return this.prisma.event.findMany({
      where: isStaff ? undefined : { OR: reach },
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
   * Corrects an event's core details after it was created.
   *
   * These were fixed at creation, so a typo in the date or the names was
   * permanent and a diaspora family could not add Russian later. Validated as
   * a whole before anything is written, and the cached invitation is dropped
   * so guests see the change at once.
   *
   * Guests who already hold the invitation are not messaged from here. When
   * the date or time moves and someone was invited, the response says so in
   * `notice`, and the host chooses whether to tell them with
   * `POST /invitations/:slug/notify-changes` (decided 8 October 2026).
   */
  async updateDetails(eventId: string, dto: UpdateEventDto) {
    const current = await this.prisma.event.findUnique({
      where: { id: eventId },
      select: {
        startsAt: true,
        endsAt: true,
        timezone: true,
        locales: true,
        defaultLocale: true,
        translations: true,
        invitation: { select: { slug: true } },
      },
    });
    if (!current) throw new NotFoundException(`No event ${eventId}`);

    assertRequiredNotCleared(dto);
    const next = nextDetails(current, dto);
    const problem = detailsProblem(next) ?? (dto.translations ? translationsProblem(dto.translations, EVENT_TRANSLATABLE) : null);
    if (problem) throw new BadRequestException(problem);

    await this.prisma.event.update({
      where: { id: eventId },
      data: {
        ...next,
        type: dto.type,
        title: dto.title,
        hostsLabel: dto.hostsLabel,
        sideALabel: dto.sideALabel,
        sideBLabel: dto.sideBLabel,
        translations: dto.translations
          ? (mergeTranslations(current.translations, dto.translations) as Prisma.InputJsonValue)
          : undefined,
      },
    });
    if (current.invitation) await this.cache.invalidateInvitation(current.invitation.slug);

    const changed = changedFields(current, next, NOTICE_WORTHY);
    const householdsInvited = changed.length > 0 ? await countInvitedHouseholds(this.prisma, eventId) : 0;
    return {
      ...(await this.findOne(eventId)),
      notice: { isSuggested: householdsInvited > 0, changed, householdsInvited },
    };
  }

  /**
   * Changes the settings a host can reasonably flip themselves.
   *
   * Kept apart from the details: these change how Aveline behaves, not what
   * the invitation says, so nobody needs telling.
   */
  async updateSettings(
    eventId: string,
    settings: { remindersEnabled?: boolean; visibility?: EventVisibility },
  ) {
    await this.findOne(eventId);

    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.event.update({
        where: { id: eventId },
        data: {
          remindersEnabled: settings.remindersEnabled ?? undefined,
          visibility: settings.visibility ?? undefined,
        },
        select: { id: true, remindersEnabled: true, visibility: true },
      });

      // A private event must never be listed. Taking the listing down in the
      // same transaction means there is no moment where the event is private
      // and its announcement is still public.
      if (settings.visibility === EventVisibility.PRIVATE) {
        await tx.eventListing.updateMany({
          where: { eventId, publishedAt: { not: null } },
          data: { publishedAt: null },
        });
      }

      return updated;
    });
  }

}

/** The details after the edit: what was sent, else what was there. */
function nextDetails(current: EventDetails, dto: UpdateEventDto): EventDetails {
  return {
    startsAt: dto.startsAt ? new Date(dto.startsAt) : current.startsAt,
    endsAt: dto.endsAt === undefined ? current.endsAt : optionalDate(dto.endsAt),
    timezone: dto.timezone ?? current.timezone,
    locales: dto.locales ?? current.locales,
    defaultLocale: dto.defaultLocale ?? current.defaultLocale,
  };
}

/** Fields an event cannot be without. `null` on one is a mistake to name, not to ignore. */
const REQUIRED_DETAILS = ['type', 'title', 'hostsLabel', 'startsAt', 'timezone', 'locales', 'defaultLocale'] as const;

function assertRequiredNotCleared(dto: UpdateEventDto): void {
  const cleared = REQUIRED_DETAILS.find((field) => dto[field] === null);
  if (cleared) throw new BadRequestException(`${cleared}: cannot be cleared`);
}

/** A date sent as a string, or null when the field was cleared. */
function optionalDate(value: string | null): Date | null {
  return value === null ? null : new Date(value);
}
