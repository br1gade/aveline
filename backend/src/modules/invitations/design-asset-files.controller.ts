import { Controller, Get, Header, Param, Res } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { CurrentActor, EventScope, Public, RequestActor, RequirePermission } from '../../infra/auth/actor';
import { DesignAssetFilesService } from './design-asset-files.service';
@ApiTags('invitations')
@Controller()
export class DesignAssetFilesController {
  constructor(private readonly files: DesignAssetFilesService) {}
  @Public() @Get('invitations/:slug/design-assets/:assetId/file') @Header('Cache-Control', 'private, no-store')
  @ApiOperation({ summary: 'Read a published public/unlisted invitation private design asset without redirect' })
  async generic(@Param() params: { slug: string; assetId: string }, @Res() response: Response) {
    sendDesignAsset(response, await this.files.readGuest(params));
  }
  @Public() @Get('invitations/:slug/g/:guestToken/design-assets/:assetId/file') @Header('Cache-Control', 'private, no-store')
  @ApiOperation({ summary: 'Read private design artwork through the live guest capability and pin' })
  async personal(@Param() params: { slug: string; guestToken: string; assetId: string }, @Res() response: Response) {
    sendDesignAsset(response, await this.files.readGuest({ slug: params.slug, assetId: params.assetId, token: params.guestToken }));
  }
  @RequirePermission('invitation:read') @EventScope('eventId') @Get('events/:eventId/design-templates/:templateKey/assets/:assetId/file') @Header('Cache-Control', 'private, no-store')
  @ApiOperation({ summary: 'Read published catalogue sample artwork within the authorized event organization' })
  async catalogue(@CurrentActor() actor: RequestActor, @Param() params: { eventId: string; templateKey: string; assetId: string }, @Res() response: Response) {
    sendDesignAsset(response, await this.files.readCatalogue(actor.userId, params));
  }
  @RequirePermission('invitation:read') @EventScope('eventId') @Get('events/:eventId/design-assets/:assetId/file') @Header('Cache-Control', 'private, no-store')
  @ApiOperation({ summary: 'Read authorized event-private design or ready preview artwork' })
  async editor(@CurrentActor() actor: RequestActor, @Param() params: { eventId: string; assetId: string }, @Res() response: Response) {
    sendDesignAsset(response, await this.files.readEditor(actor.userId, params));
  }
}
function sendDesignAsset(response: Response, file: { buffer: Buffer; mimeType: string }) {
  response.setHeader('Content-Type', file.mimeType); response.setHeader('Cache-Control', 'private, no-store');
  response.setHeader('X-Content-Type-Options', 'nosniff'); response.send(file.buffer);
}
