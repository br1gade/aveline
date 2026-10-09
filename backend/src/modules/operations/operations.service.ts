import { Injectable, NotFoundException } from '@nestjs/common';
import { GuestAttribution, RsvpStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AnalyticsService } from '../../infra/analytics/analytics.service';
import { BuiltInField, optionLabel } from '../rsvp/rsvp-fields';

/**
 * Every surface here is a *derived view* over the guest graph (spec §6).
 * Nothing in this file is separately maintained data — it all falls out of
 * answers the guests themselves gave. That is the product thesis in code:
 * ask once on the invitation, and the operational plan assembles itself.
 */
@Injectable()
export class OperationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly analytics: AnalyticsService,
  ) {}

  /**
   * Everything the operations screen renders, in one request.
   *
   * The product rule (spec §12): a screen is one round trip. Five separate
   * calls would make the dashboard render in five waves, each with its own
   * spinner and its own failure mode. The sheets run concurrently because
   * none depends on another — the wall-clock cost is the slowest query, not
   * their sum.
   */
  async dashboard(eventId: string) {
    await this.assertEvent(eventId);

    const [headcount, catering, bar, playlist, views] = await Promise.all([
      this.headcount(eventId),
      this.cateringSheet(eventId),
      this.barSheet(eventId),
      this.playlist(eventId),
      this.analytics.invitationViewSummary(eventId),
    ]);

    return {
      headcount,
      catering,
      bar,
      playlist,
      engagement: views,
      generatedAt: new Date().toISOString(),
    };
  }

  /** Live headcount, broken down by response, household and side. */
  async headcount(eventId: string) {
    await this.assertEvent(eventId);

    const guests = await this.prisma.guest.findMany({
      where: { eventId },
      include: { rsvp: true },
    });

    const tally = (s: RsvpStatus) =>
      guests.filter((g) => (g.rsvp?.status ?? RsvpStatus.PENDING) === s).length;

    const bySide = Object.values(GuestAttribution).map((side) => ({
      side,
      invited: guests.filter((g) => g.attribution === side).length,
      attending: guests.filter(
        (g) => g.attribution === side && g.rsvp?.status === RsvpStatus.ATTENDING,
      ).length,
    }));

    const households = await this.prisma.household.count({ where: { eventId } });
    const responded = guests.filter((g) => g.rsvp?.respondedAt).length;

    return {
      invited: guests.length,
      households,
      attending: tally(RsvpStatus.ATTENDING),
      declined: tally(RsvpStatus.DECLINED),
      undecided: tally(RsvpStatus.UNDECIDED),
      pending: tally(RsvpStatus.PENDING),
      responseRate: guests.length === 0 ? 0 : Math.round((responded / guests.length) * 100),
      bySide,
    };
  }

  /** Confirmed headcount plus every dietary requirement — hand to the venue. */
  async cateringSheet(eventId: string) {
    await this.assertEvent(eventId);

    const attending = await this.prisma.guest.findMany({
      where: { eventId, rsvp: { status: RsvpStatus.ATTENDING } },
      include: { rsvp: true, household: true },
      orderBy: [{ household: { name: 'asc' } }, { firstName: 'asc' }],
    });

    const requirements = new Map<string, number>();
    for (const guest of attending) {
      for (const item of guest.rsvp?.dietary ?? []) {
        requirements.set(item, (requirements.get(item) ?? 0) + 1);
      }
    }
    const labels = await this.choiceLabels(eventId);

    return {
      covers: attending.length,
      requirements: [...requirements.entries()]
        .map(([key, count]) => ({ requirement: labels('dietary', key), key, count }))
        .sort((a, b) => b.count - a.count),
      notes: attending
        .filter((g) => g.rsvp?.dietaryNotes)
        .map((g) => ({
          guest: [g.firstName, g.lastName].filter(Boolean).join(' '),
          household: g.household.name,
          note: g.rsvp!.dietaryNotes,
        })),
    };
  }

  /** Drink preferences aggregated into quantities — hand to the bar. */
  async barSheet(eventId: string) {
    await this.assertEvent(eventId);

    const rows = await this.prisma.rsvp.groupBy({
      by: ['drinkPreference'],
      where: { status: RsvpStatus.ATTENDING, guest: { eventId }, drinkPreference: { not: null } },
      _count: { drinkPreference: true },
      orderBy: { _count: { drinkPreference: 'desc' } },
    });

    const total = rows.reduce((sum, r) => sum + r._count.drinkPreference, 0);
    const labels = await this.choiceLabels(eventId);

    return {
      totalResponses: total,
      preferences: rows.map((r) => ({
        // Counted by key, shown by label: with fixed choices every language is one row.
        drink: labels('drinkPreference', r.drinkPreference ?? ''),
        key: r.drinkPreference,
        guests: r._count.drinkPreference,
        share: total === 0 ? 0 : Math.round((r._count.drinkPreference / total) * 100),
      })),
    };
  }

  /** Song requests, deduplicated — hand to the musician. */
  async playlist(eventId: string) {
    await this.assertEvent(eventId);

    const rsvps = await this.prisma.rsvp.findMany({
      where: { guest: { eventId }, songRequest: { not: null } },
      select: { songRequest: true },
    });

    const counts = new Map<string, number>();
    for (const { songRequest } of rsvps) {
      const key = songRequest!.trim();
      if (key) counts.set(key, (counts.get(key) ?? 0) + 1);
    }

    return {
      uniqueTracks: counts.size,
      tracks: [...counts.entries()]
        .map(([track, requests]) => ({ track, requests }))
        .sort((a, b) => b.requests - a.requests || a.track.localeCompare(b.track)),
    };
  }

  /** Free-text messages collected into a guest book. */
  async guestBook(eventId: string) {
    await this.assertEvent(eventId);

    const rsvps = await this.prisma.rsvp.findMany({
      where: { guest: { eventId }, message: { not: null } },
      include: { guest: true },
      orderBy: { respondedAt: 'desc' },
    });

    return rsvps.map((r) => ({
      from: [r.guest.firstName, r.guest.lastName].filter(Boolean).join(' '),
      message: r.message,
      at: r.respondedAt,
    }));
  }

  /**
   * Turns a stored choice key into its label in the event's language, using
   * the invitation's configured choices. Free text comes back as typed.
   */
  private async choiceLabels(eventId: string) {
    const event = await this.prisma.event.findUnique({
      where: { id: eventId },
      select: { defaultLocale: true, invitation: { select: { rsvpFields: true } } },
    });
    const config = event?.invitation?.rsvpFields ?? {};
    const locale = event?.defaultLocale ?? 'hy';
    return (field: BuiltInField, key: string) => optionLabel(config, field, key, locale);
  }

  private async assertEvent(eventId: string) {
    const exists = await this.prisma.event.findUnique({ where: { id: eventId }, select: { id: true } });
    if (!exists) throw new NotFoundException(`No event ${eventId}`);
  }
}
