import { Throttle } from '@nestjs/throttler';
import { GUEST_PAGE_LIMITS } from '../../infra/auth/throttler.guard';
import { BadRequestException, Body, Controller, Delete, Get, Header, Param, Post, Query, Res, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBody, ApiConsumes, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { Public } from '../../infra/auth/actor';
import { AcknowledgementsService } from './acknowledgements.service';
import { ContributionPageDto, GalleryUploadDto, PrivateImageQuery, SignAcknowledgementDto, LinkParams, LinkMediaParams, LinkAcknowledgementParams } from './contribution.dto';
import { GALLERY_UPLOAD_LIMIT, GuestMediaService, SIGNATURE_UPLOAD_LIMIT } from './guest-media.service';

@ApiTags('guest-contributions')
@Controller('invitations/:slug/g/:guestToken')
export class ContributionsController {
  constructor(private readonly acknowledgements: AcknowledgementsService, private readonly media: GuestMediaService) {}

  @Public()
  @Header('Cache-Control', 'private, no-store')
  @Get('acknowledgements')
  @ApiOperation({ summary: 'Current statements and this household’s acknowledgement history' })
  listAcknowledgements(@Param('slug') slug: string, @Param('guestToken') token: string, @Query() page: ContributionPageDto) {
    return this.acknowledgements.forGuest(slug, token, page);
  }
  @Public()
  @Post('acknowledgements')
  @ApiOperation({ summary: 'Acknowledge a versioned statement for explicitly selected household members' })
  sign(@Param('slug') slug: string, @Param('guestToken') token: string, @Body() dto: SignAcknowledgementDto) {
    return this.acknowledgements.sign(slug, token, dto);
  }
  @Public()
  @Post('signature-uploads')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: SIGNATURE_UPLOAD_LIMIT, files: 1, fields: 0, parts: 1 } }))
  @ApiConsumes('multipart/form-data')
  @ApiBody({ schema: { type: 'object', properties: { file: { type: 'string', format: 'binary' } } } })
  @ApiOperation({ summary: 'Stage a private drawn signature for background validation' })
  uploadSignature(@Param('slug') slug: string, @Param('guestToken') token: string, @UploadedFile() file?: Express.Multer.File) {
    if (!file) throw new BadRequestException('file: an image is required');
    return this.media.upload({ slug, token }, 'SIGNATURE', file);
  }
  @Public()
  @Header('Cache-Control', 'private, no-store')
  @Throttle(GUEST_PAGE_LIMITS)
  @Get('signature-uploads/:mediaId/file')
  @ApiOperation({ summary: 'Preview your processed signature; credentials required' })
  async signatureFile(@Param() params: LinkMediaParams, @Res() response: Response) {
    sendPrivateImage(response, await this.media.readGuest({ slug: params.slug, token: params.guestToken }, params.mediaId, { kind: 'SIGNATURE', variant: 'display' }));
  }
  @Public()
  @Delete('signature-uploads/:mediaId')
  @ApiOperation({ summary: 'Remove your unclaimed signature upload' })
  removeSignature(@Param('slug') slug: string, @Param('guestToken') token: string, @Param('mediaId') id: string) {
    return this.media.removeGuest({ slug, token }, id, 'SIGNATURE');
  }
  @Public()
  @Header('Cache-Control', 'private, no-store')
  @Throttle(GUEST_PAGE_LIMITS)
  @Get('acknowledgements/:acknowledgementId/file')
  @ApiOperation({ summary: 'Read a drawn acknowledgement visible to this guest’s household' })
  async acknowledgementFile(@Param() params: LinkAcknowledgementParams, @Res() response: Response) {
    const id = await this.acknowledgements.requireGuestRecord(params.slug, params.guestToken, params.acknowledgementId);
    const image = await this.media.readGuest({ slug: params.slug, token: params.guestToken }, id, { kind: 'SIGNATURE', variant: 'display', acknowledgementId: params.acknowledgementId });
    await this.acknowledgements.requireGuestRecord(params.slug, params.guestToken, params.acknowledgementId);
    sendPrivateImage(response, image);
  }
  @Public()
  @Header('Cache-Control', 'private, no-store')
  @Get('gallery')
  @ApiOperation({ summary: 'Approved gallery photos plus your own pending uploads; private paginated view' })
  gallery(@Param('slug') slug: string, @Param('guestToken') token: string, @Query() page: ContributionPageDto) {
    return this.media.listGuest(slug, token, page);
  }
  @Public()
  @Post('gallery')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: GALLERY_UPLOAD_LIMIT, files: 1, fields: 1, fieldSize: 2000, parts: 2 } }))
  @ApiConsumes('multipart/form-data')
  @ApiBody({ schema: { type: 'object', properties: { file: { type: 'string', format: 'binary' }, caption: { type: 'string', maxLength: 500 } } } })
  @ApiOperation({ summary: 'Upload a private gallery photo requiring host approval after processing' })
  uploadGallery(@Param() params: LinkParams, @Body() dto: GalleryUploadDto, @UploadedFile() file?: Express.Multer.File) {
    if (!file) throw new BadRequestException('file: an image is required');
    return this.media.upload({ slug: params.slug, token: params.guestToken }, 'GALLERY', file, dto.caption);
  }
  @Public()
  @Header('Cache-Control', 'private, no-store')
  @Throttle(GUEST_PAGE_LIMITS)
  @Get('gallery/:mediaId/file')
  @ApiOperation({ summary: 'Read an authorized processed gallery variant; originals are never served' })
  async galleryFile(@Param() params: LinkMediaParams, @Query() query: PrivateImageQuery, @Res() response: Response) {
    sendPrivateImage(response, await this.media.readGuest({ slug: params.slug, token: params.guestToken }, params.mediaId, { kind: 'GALLERY', variant: query.variant ?? 'display' }));
  }
  @Public()
  @Delete('gallery/:mediaId')
  @ApiOperation({ summary: 'Remove your own gallery photo, including after approval' })
  removeGallery(@Param('slug') slug: string, @Param('guestToken') token: string, @Param('mediaId') id: string) {
    return this.media.removeGuest({ slug, token }, id, 'GALLERY');
  }
}
export function sendPrivateImage(response: Response, image: { buffer: Buffer; mimeType: string }) {
  response.set({ 'Content-Type': image.mimeType, 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer',
    'Content-Disposition': 'inline', 'Content-Length': String(image.buffer.length) }).send(image.buffer);
}
