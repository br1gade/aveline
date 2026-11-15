import { Controller, HttpCode, HttpStatus, NotFoundException, Param, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { MessageChannel, SuppressionReason } from '@prisma/client';
import { Public } from '../../infra/auth/actor';
import { PrismaService } from '../../prisma/prisma.service';
import { isGenuineUnsubscribe, unsubscribeSecret, unsubscribeUrlFor } from './email-unsubscribe';
import { SuppressionService } from './suppression.service';

/**
 * The target of the List-Unsubscribe header on a host's guest mail. A mail
 * client POSTs it (RFC 8058); nothing here is for a browser.
 */
@ApiTags('communications')
@Controller('email-unsubscribe')
export class EmailUnsubscribeController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly suppressions: SuppressionService,
  ) {}

  @Public()
  @Post(':messageId/:signature')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'One-click unsubscribe from a host’s guest mail',
    description: 'Stops that organization’s mail to the address the message went to. Idempotent. 404 for a link that is not genuine.',
  })
  async unsubscribe(@Param('messageId') messageId: string, @Param('signature') signature: string): Promise<void> {
    if (!isGenuineUnsubscribe(messageId, signature, unsubscribeSecret())) throw notFound();
    const message = await this.prisma.message.findUnique({
      where: { id: messageId },
      select: { id: true, channel: true, templateKey: true, organizationId: true, toAddress: true },
    });
    // The same rule that put the link in the mail: only mail a guest may stop.
    if (!message?.organizationId || !unsubscribeUrlFor(message, '', unsubscribeSecret())) throw notFound();
    await this.suppressions.suppress({
      organizationId: message.organizationId, channel: MessageChannel.EMAIL, address: message.toAddress,
      reason: SuppressionReason.UNSUBSCRIBED, notes: `one-click unsubscribe from ${message.templateKey ?? 'a message'}`,
    });
  }
}

const notFound = () => new NotFoundException('No such unsubscribe link');
