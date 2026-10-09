import { Module } from '@nestjs/common';
import { ImageVariantsService } from './image-variants.service';
import { MediaController } from './media.controller';
import { MediaService } from './media.service';

@Module({
  controllers: [MediaController],
  providers: [MediaService, ImageVariantsService],
  exports: [MediaService, ImageVariantsService],
})
export class MediaModule {}
