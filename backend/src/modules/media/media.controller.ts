import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBody, ApiConsumes, ApiOperation, ApiTags } from '@nestjs/swagger';
import { MediaKind } from '@prisma/client';
import { EventScope, RequirePermission } from '../../infra/auth/actor';
import { MAX_UPLOAD_BYTES } from '../../infra/storage/storage.service';
import { UpdateMediaDto } from './dto/update-media.dto';
import { MediaService } from './media.service';

@ApiTags('media')
@Controller('events/:eventId/media')
export class MediaController {
  constructor(private readonly media: MediaService) {}

  @RequirePermission('invitation:design')
  @EventScope('eventId')
  @Post()
  // Refused while it streams in: unbounded, a stranger's upload sat whole in memory first.
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_UPLOAD_BYTES, files: 1 } }))
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

  @RequirePermission('invitation:read')
  @Get()
  @ApiOperation({ summary: "The event's uploads, newest first, with the blocks that show each" })
  list(@Param('eventId') eventId: string) {
    return this.media.list(eventId);
  }

  @RequirePermission('invitation:design')
  @Patch(':assetId')
  @ApiOperation({
    summary: 'Describe an upload for guests who cannot see it',
    description: 'Alt text per language; a language sent replaces that one, null removes it.',
  })
  update(@Param('eventId') eventId: string, @Param('assetId') assetId: string, @Body() dto: UpdateMediaDto) {
    return this.media.updateAltText(eventId, assetId, dto.altText);
  }

  @RequirePermission('invitation:design')
  @Delete(':assetId')
  @ApiOperation({ summary: 'Remove an upload, file and all', description: 'Refused while a block shows it.' })
  remove(@Param('eventId') eventId: string, @Param('assetId') assetId: string) {
    return this.media.remove(eventId, assetId);
  }
}
