import {
  BadRequestException,
  Controller,
  Param,
  Post,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBody, ApiConsumes, ApiOperation, ApiTags } from '@nestjs/swagger';
import { MediaKind } from '@prisma/client';
import { EventScope, RequirePermission } from '../../infra/auth/actor';
import { MediaService } from './media.service';

@ApiTags('media')
@Controller('events/:eventId/media')
export class MediaController {
  constructor(private readonly media: MediaService) {}

  @RequirePermission('invitation:design')
  @EventScope('eventId')
  @Post()
  @UseInterceptors(FileInterceptor('file'))
  @ApiConsumes('multipart/form-data')
  @ApiOperation({
    summary: 'Upload an image or audio file for an event',
    description:
      'Assets are scoped to an event, so deleting the event reclaims its storage ' +
      'and no asset is reachable from an unrelated invitation.',
  })
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        file: { type: 'string', format: 'binary' },
        kind: { type: 'string', enum: Object.values(MediaKind) },
      },
    },
  })
  upload(@Param('eventId') eventId: string, @UploadedFile() file?: Express.Multer.File) {
    if (!file) throw new BadRequestException('A file is required');
    return this.media.upload(eventId, file);
  }
}
