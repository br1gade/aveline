import { Controller, Get, Param, Res } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { RequirePermission } from '../../infra/auth/actor';
import { ContributionPrivacyFiles } from './contribution-privacy';

@ApiTags('privacy')
@Controller('privacy/requests/:requestId/guest-media')
export class ContributionPrivacyController {
  constructor(private readonly files: ContributionPrivacyFiles) {}
  @RequirePermission('privacy:manage')
  @Get(':mediaId/file')
  @ApiOperation({ summary: 'Download an original private subject file for a verified export request' })
  async read(@Param('requestId') requestId: string, @Param('mediaId') mediaId: string, @Res() response: Response) {
    const image = await this.files.read(requestId, mediaId);
    response.set({ 'Content-Type': image.mimeType, 'Content-Length': String(image.buffer.length), 'Cache-Control': 'private, no-store',
      'Content-Disposition': 'attachment; filename="subject-upload.bin"', 'X-Content-Type-Options': 'nosniff' }).send(image.buffer);
  }
}
