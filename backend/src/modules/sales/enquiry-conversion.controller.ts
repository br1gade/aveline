import { Request, Response } from 'express';
import { Body, Controller, Header, Param, Post, Req, Res, UseGuards } from '@nestjs/common';
import { ApiHeader, ApiTags } from '@nestjs/swagger';
import { RequestActor, RequirePermission } from '../../infra/auth/actor';
import { ConvertEnquiryDto } from './dto/enquiry-conversion.dto';
import { EnquiryConversionService } from './enquiry-conversion.service';
import { SalesIntakeGuard } from './sales-intake.guard';

@ApiTags('sales')
@Controller('sales/enquiries')
@UseGuards(SalesIntakeGuard)
@RequirePermission('enquiry:manage')
export class EnquiryConversionController {
  constructor(private readonly conversion: EnquiryConversionService) {}
  @Post(':enquiryId/conversion') @Header('Cache-Control', 'private, no-store')
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  async convert(@Req() request: Request & { actor: RequestActor }, @Param('enquiryId') enquiryId: string, @Body() dto: ConvertEnquiryDto, @Res({ passthrough: true }) response: Response) {
    const { wasExisting, ...result } = await this.conversion.convert(request.actor.userId, enquiryId, { key: String(request.headers['idempotency-key'] ?? ''), dto, organizationSelector: request.headers['x-aveline-organization-id'] as string | undefined });
    response.status(wasExisting ? 200 : 201);
    return { ...result, conversion: result.enquiry.conversion };
  }
}
