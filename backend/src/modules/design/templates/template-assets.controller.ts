import { BadRequestException, Body, Controller, Delete, Get, Header, HttpCode, Param, Patch, Post, Res, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiConsumes, ApiOperation, ApiProperty, ApiTags } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsIn, IsInt, IsString, IsUUID, Max, MaxLength, Min, ValidateNested } from 'class-validator';
import type { Response } from 'express';
import { CurrentActor, RequestActor, RequirePermission } from '../../../infra/auth/actor';
import { TEMPLATE_UPLOAD_BYTES } from './template-raster';
import { TemplateAssetsService } from './template-assets.service';
import { TemplateRevisionDto } from './template.dto';
class TemplateArtworkReferenceDto {
  @ApiProperty() @IsString() @MaxLength(128) assetId!: string;
  @ApiProperty({ enum: ['HERO', 'GALLERY'] }) @IsIn(['HERO', 'GALLERY']) slot!: string;
}
class AttachTemplateArtworkDto extends TemplateRevisionDto {
  @ApiProperty({ type: [TemplateArtworkReferenceDto] }) @IsArray() @ArrayMaxSize(20) @ValidateNested({ each: true }) @Type(() => TemplateArtworkReferenceDto) artwork!: TemplateArtworkReferenceDto[];
}
class TemplateAssetUploadDto {
  @ApiProperty() @Type(() => Number) @IsInt() @Min(1) @Max(2147483647) expectedRevision!: number;
  @ApiProperty() @IsUUID() idempotencyKey!: string;
  @ApiProperty({ enum: ['PHOTO', 'COVER'] }) @IsIn(['PHOTO', 'COVER']) kind!: string;
}
@ApiTags('template-authoring')
@Controller('design-templates/:templateId')
export class TemplateAssetsController {
  constructor(private readonly assets: TemplateAssetsService) {}
  @RequirePermission('template:author') @Post('drafts/:draftId/assets') @HttpCode(202)
  @Header('Cache-Control', 'private, no-store')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: TEMPLATE_UPLOAD_BYTES, files: 1, fields: 3, fieldSize: 128, parts: 4 } }))
  @ApiConsumes('multipart/form-data')
  @ApiOperation({ summary: 'Stage private raster artwork for background sanitization; no public source URL' })
  upload(@CurrentActor() actor: RequestActor, @Param() params: { templateId: string; draftId: string }, @Body() dto: TemplateAssetUploadDto, @UploadedFile() file?: Express.Multer.File) {
    if (!file) throw new BadRequestException('file: one raster image required');
    return this.assets.upload(actor.userId, { ...params, ...dto, file });
  }
  @RequirePermission('template:author') @Patch('drafts/:draftId/artwork')
  @Header('Cache-Control', 'private, no-store')
  @ApiOperation({ summary: 'Replace ordered same-template artwork defaults in reviewed renderer slots' })
  attach(@CurrentActor() actor: RequestActor, @Param() params: { templateId: string; draftId: string }, @Body() dto: AttachTemplateArtworkDto) {
    return this.assets.attach(actor.userId, { ...params, ...dto });
  }
  @RequirePermission('template:author') @Get('assets/:assetId/file')
  @Header('Cache-Control', 'private, no-store')
  @ApiOperation({ summary: 'Read sanitized artwork with current assignment checked before and after storage IO' })
  async file(@CurrentActor() actor: RequestActor, @Param() params: { templateId: string; assetId: string }, @Res() response: Response) {
    const file = await this.assets.read(actor.userId, params);
    response.setHeader('Cache-Control', 'private, no-store'); response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Content-Type', file.mimeType); response.send(file.buffer);
  }
  @RequirePermission('template:author') @Delete('drafts/:draftId/assets/:assetId')
  @Header('Cache-Control', 'private, no-store')
  @ApiOperation({ summary: 'Retire unreferenced draft artwork with durable object cleanup tombstones' })
  remove(@CurrentActor() actor: RequestActor, @Param() params: { templateId: string; draftId: string; assetId: string }, @Body() dto: TemplateRevisionDto) {
    return this.assets.remove(actor.userId, { ...params, ...dto });
  }
}
