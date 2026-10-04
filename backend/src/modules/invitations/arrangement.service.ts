import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { BlockType, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { CacheService } from '../../infra/cache/cache.service';
import { ArrangeBlocksDto, BlockPlacementDto } from './dto/arrange-blocks.dto';

type Placement = Pick<BlockPlacementDto, 'type'> & Partial<BlockPlacementDto>;

/**
 * Validates an arrangement before any write, so a rejected request changes
 * nothing. Exported separately from the service because it is pure and worth
 * testing without a database.
 */
export function assertArrangementIsValid(
  blocks: Placement[],
  supportedBlocks: BlockType[],
): void {
  const seen = new Set<BlockType>();
  for (const block of blocks) {
    if (seen.has(block.type)) {
      throw new BadRequestException(`Block ${block.type} appears more than once`);
    }
    seen.add(block.type);
  }

  // An empty list means the template declares no restriction.
  if (supportedBlocks.length === 0) return;

  const unsupported = blocks.filter((block) => !supportedBlocks.includes(block.type));
  if (unsupported.length > 0) {
    throw new BadRequestException(
      `Template does not support: ${unsupported.map((block) => block.type).join(', ')}`,
    );
  }
}

/**
 * Rearranging an invitation is one request, not one request per block.
 *
 * The product rule this implements (spec §12): the shortest path from intent
 * to result. A host dragging three blocks and toggling one should produce a
 * single atomic call, not five that can half-fail and leave the page wrong.
 */
@Injectable()
export class ArrangementService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cache: CacheService,
  ) {}

  async arrange(slug: string, dto: ArrangeBlocksDto) {
    const invitation = await this.prisma.invitation.findUnique({
      where: { slug },
      select: { id: true, template: { select: { supportedBlocks: true } } },
    });
    if (!invitation) throw new NotFoundException(`No invitation at "${slug}"`);

    assertArrangementIsValid(dto.blocks, invitation.template.supportedBlocks);

    const blocks = await this.prisma.$transaction((tx) =>
      Promise.all(dto.blocks.map((block, index) => this.upsertBlock(tx, invitation.id, block, index))),
    );

    await this.cache.invalidateInvitation(slug);

    return {
      slug,
      blocks: blocks.map((block) => ({
        type: block.type,
        sortOrder: block.sortOrder,
        enabled: block.enabled,
        variant: block.variant,
      })),
    };
  }

  private upsertBlock(
    tx: Prisma.TransactionClient,
    invitationId: string,
    block: BlockPlacementDto,
    index: number,
  ) {
    const placement = {
      sortOrder: index,
      ...(block.enabled === undefined ? {} : { enabled: block.enabled }),
      ...(block.variant === undefined ? {} : { variant: block.variant }),
    };

    return tx.invitationBlock.upsert({
      where: { invitationId_type: { invitationId, type: block.type } },
      create: { invitationId, type: block.type, ...placement },
      update: placement,
    });
  }
}
