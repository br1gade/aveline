import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { CreatePromoCodeDto, UpdatePromoCodeDto } from './dto/promo-code.dto';
import { PromoEvaluation, evaluatePromoCode } from './promo-code';
import { isUniqueViolation } from '../../common/prisma-errors';

/** Either the client or an open transaction, so a redemption can be part of
 *  the same atomic unit as the order it belongs to. */
type Executor = Pick<PrismaService, '$executeRaw'> | Prisma.TransactionClient;

export interface ClaimedPromoCode { promoCodeId: string; discountMinor: bigint }

@Injectable()
export class PromoCodesService {
  constructor(private readonly prisma: PrismaService) {}

  async list(organizationId: string) {
    const codes = await this.prisma.promoCode.findMany({
      where: { organizationId },
      orderBy: { createdAt: 'desc' },
      include: { event: { select: { id: true, title: true } } },
    });

    return codes.map((code) => describe(code));
  }

  async create(organizationId: string, dto: CreatePromoCodeDto) {
    assertSensibleValue(dto);
    if (dto.eventId) await this.assertEventBelongsToOrg(organizationId, dto.eventId);

    try {
      const created = await this.prisma.promoCode.create({
        data: {
          organizationId,
          eventId: dto.eventId ?? null,
          code: normalizeCode(dto.code),
          kind: dto.kind,
          value: BigInt(dto.value),
          maxRedemptions: dto.maxRedemptions ?? null,
          minOrderMinor: dto.minOrderMinor === undefined ? null : BigInt(dto.minOrderMinor),
          validFrom: dto.validFrom ? new Date(dto.validFrom) : null,
          validUntil: dto.validUntil ? new Date(dto.validUntil) : null,
        },
      });
      return describe(created);
    } catch (error) {
      // The unique constraint is the check — asking first would still race.
      if (isUniqueViolation(error)) {
        throw new ConflictException(`You already have a code called ${normalizeCode(dto.code)}`);
      }
      throw error;
    }
  }

  /**
   * Changes the limits, never the discount.
   *
   * A code's `kind` and `value` are fixed once it exists, because orders
   * record the discount they were given and a buyer holding a poster must get
   * what it advertises. Withdrawing a code is deactivating it, not editing it.
   */
  async update(organizationId: string, codeId: string, dto: UpdatePromoCodeDto) {
    const code = await this.findOwned(organizationId, codeId);

    if (dto.maxRedemptions !== undefined && dto.maxRedemptions < code.redemptions) {
      throw new BadRequestException(
        `This code has already been used ${code.redemptions} time(s); the limit cannot be lower`,
      );
    }

    const updated = await this.prisma.promoCode.update({
      where: { id: codeId },
      data: {
        maxRedemptions: dto.maxRedemptions ?? undefined,
        validUntil: dto.validUntil ? new Date(dto.validUntil) : undefined,
        isActive: dto.isActive ?? undefined,
      },
    });
    return describe(updated);
  }

  /**
   * Codes are deactivated, not deleted: `TicketOrder.promoCodeId` records what
   * a buyer was given, and that history is what a refund is calculated from.
   */
  async deactivate(organizationId: string, codeId: string) {
    await this.findOwned(organizationId, codeId);
    const updated = await this.prisma.promoCode.update({
      where: { id: codeId },
      data: { isActive: false },
    });
    return describe(updated);
  }

  /** What a code is worth on this order, or why it does not apply. */
  async evaluate(
    organizationId: string,
    code: string,
    order: { eventId: string; subtotalMinor: bigint },
  ): Promise<PromoEvaluation & { promoCodeId?: string }> {
    const found = await this.prisma.promoCode.findUnique({
      where: { organizationId_code: { organizationId, code: normalizeCode(code) } },
    });
    if (!found) return { isApplicable: false, reason: 'We do not recognise that code' };

    const evaluation = evaluatePromoCode(found, order, new Date());
    return evaluation.isApplicable ? { ...evaluation, promoCodeId: found.id } : evaluation;
  }

  /**
   * Takes one redemption, or refuses.
   *
   * The count is incremented by a single conditional UPDATE carrying the limit
   * in its WHERE clause, so a code with one redemption left cannot be taken by
   * two simultaneous buyers. Re-checking `redemptions` in Node after reading
   * it — which is what `evaluate` does for the preview — is not safe here, and
   * the two are deliberately different: a preview may be stale, a redemption
   * may not.
   *
   * Pass the checkout's transaction so an order that fails to record gives the
   * redemption back by rolling back, rather than by a compensating write that
   * might not run.
   */
  async claim(
    organizationId: string,
    code: string,
    order: { eventId: string; subtotalMinor: bigint },
    tx: Executor,
  ): Promise<ClaimedPromoCode> {
    const evaluation = await this.evaluate(organizationId, code, order);
    if (!evaluation.isApplicable) throw new BadRequestException(evaluation.reason);

    const claimed = await tx.$executeRaw`
      UPDATE "promo_codes"
         SET "redemptions" = "redemptions" + 1,
             "updatedAt" = NOW()
       WHERE "id" = ${evaluation.promoCodeId!}
         AND "isActive" = true
         AND ("maxRedemptions" IS NULL OR "redemptions" < "maxRedemptions")
    `;

    // Lost the race for the last redemption. A 409 rather than a 400, because
    // the request was valid when it was made.
    if (claimed === 0) throw new ConflictException('This code has just run out');

    return { promoCodeId: evaluation.promoCodeId!, discountMinor: evaluation.discountMinor };
  }

  /**
   * Gives a redemption back when the order it was taken for never completed.
   *
   * Floored at zero so a double release cannot mint redemptions on a capped
   * code — the same reason inventory releases carry their own guard.
   */
  async releaseClaim(promoCodeId: string | null, tx: Executor = this.prisma): Promise<void> {
    if (!promoCodeId) return;

    await tx.$executeRaw`
      UPDATE "promo_codes"
         SET "redemptions" = "redemptions" - 1,
             "updatedAt" = NOW()
       WHERE "id" = ${promoCodeId}
         AND "redemptions" > 0
    `;
  }

  private async findOwned(organizationId: string, codeId: string) {
    const code = await this.prisma.promoCode.findFirst({ where: { id: codeId, organizationId } });
    if (!code) throw new NotFoundException('No such promo code');
    return code;
  }

  private async assertEventBelongsToOrg(organizationId: string, eventId: string) {
    const event = await this.prisma.event.findFirst({
      where: { id: eventId, organizationId },
      select: { id: true },
    });
    if (!event) throw new NotFoundException('No such event in this organization');
  }
}

/** Codes are typed by hand, so case is not part of the identity. */
function normalizeCode(code: string): string {
  return code.trim().toUpperCase();
}

function assertSensibleValue(dto: CreatePromoCodeDto): void {
  const value = BigInt(dto.value);
  if (value <= 0n) throw new BadRequestException('A discount must be worth something');

  if (dto.kind === 'PERCENT' && value > 100n) {
    throw new BadRequestException('A percentage discount cannot exceed 100');
  }
  if (dto.validFrom && dto.validUntil && new Date(dto.validFrom) >= new Date(dto.validUntil)) {
    throw new BadRequestException('validUntil must be after validFrom');
  }
}

interface PromoCodeRow {
  id: string;
  code: string;
  kind: string;
  value: bigint;
  eventId: string | null;
  maxRedemptions: number | null;
  redemptions: number;
  minOrderMinor: bigint | null;
  validFrom: Date | null;
  validUntil: Date | null;
  isActive: boolean;
  event?: { id: string; title: string } | null;
}

function describe(code: PromoCodeRow) {
  return {
    id: code.id,
    code: code.code,
    kind: code.kind,
    value: code.value.toString(),
    eventId: code.eventId,
    event: code.event ?? undefined,
    maxRedemptions: code.maxRedemptions,
    redemptions: code.redemptions,
    // What a host actually wants to know: how much of the code is left.
    remaining:
      code.maxRedemptions === null ? null : Math.max(0, code.maxRedemptions - code.redemptions),
    minOrderMinor: code.minOrderMinor?.toString() ?? null,
    validFrom: code.validFrom,
    validUntil: code.validUntil,
    isActive: code.isActive,
  };
}
