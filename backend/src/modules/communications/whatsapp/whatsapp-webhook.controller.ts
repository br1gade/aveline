import { Body, Controller, Get, Header, HttpCode, Post, Query, RawBodyRequest, Req, ServiceUnavailableException } from '@nestjs/common';
import { ApiHeader, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { Public } from '../../../infra/auth/actor';
import { verifyWhatsAppChallenge, verifyWhatsAppSignature } from './whatsapp-auth';
import { WhatsAppReceiptsService } from './whatsapp-receipts.service';

@ApiTags('communications')
@Controller('communications/whatsapp-webhook')
export class WhatsAppWebhookController {
  constructor(private readonly receipts: WhatsAppReceiptsService) {}

  @Public()
  @Get()
  @Header('Content-Type', 'text/plain')
  @Header('Cache-Control', 'no-store')
  @ApiOperation({ summary: 'Verify Meta webhook subscription with a configured token' })
  @ApiQuery({ name: 'hub.mode', required: true })
  @ApiQuery({ name: 'hub.verify_token', required: true })
  @ApiQuery({ name: 'hub.challenge', required: true })
  verify(@Query() query: Record<string, unknown>): string {
    return verifyWhatsAppChallenge(query, process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN);
  }

  @Public()
  @Post()
  @HttpCode(200)
  @ApiHeader({ name: 'X-Hub-Signature-256', required: true, description: 'sha256= followed by HMAC-SHA256 of exact request bytes using the Meta app secret' })
  @ApiOperation({ summary: 'Durably accept scoped Meta WhatsApp message status receipts', description: 'No user session; requires a valid Meta raw-byte signature. Batches up to 1000 statuses / 3 MiB. Outcomes reconcile asynchronously.' })
  async receive(@Req() request: RawBodyRequest<Request>, @Body() body: unknown): Promise<{ accepted: true }> {
    await verifyWhatsAppSignature(request.rawBody, request.get('x-hub-signature-256'), process.env.WHATSAPP_APP_SECRET);
    const accountId = process.env.WHATSAPP_ACCOUNT_ID;
    const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;
    if (!accountId || !phoneNumberId) throw new ServiceUnavailableException('WhatsApp receipt scope is not configured');
    return this.receipts.receive(body, { accountId, phoneNumberId });
  }
}
