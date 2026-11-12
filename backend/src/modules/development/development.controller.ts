import { Body, Controller, HttpCode, HttpStatus, Param, Post } from '@nestjs/common';
import { ApiOperation, ApiProperty, ApiTags } from '@nestjs/swagger';
import { IsString, Matches } from 'class-validator';
import { Public } from '../../infra/auth/actor';
import { DevelopmentService } from './development.service';

export class OfferPlanDto {
  @ApiProperty({ description: 'Price in minor units, as a string', example: '25000' })
  @IsString()
  @Matches(/^[1-9]\d{0,14}$/, { message: 'priceMinor must be a positive whole number' })
  priceMinor!: string;
}

const DEVELOPMENT_ONLY = 'Exists only in development and test; a 404 everywhere else.';

@ApiTags('development')
@Controller('development')
export class DevelopmentController {
  constructor(private readonly development: DevelopmentService) {}

  @Public()
  @Post('outbox/send')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Development only: send queued mail now',
    description: `${DEVELOPMENT_ONLY} Runs the once-a-minute outbox job at once; if it is already running, that run sends.`,
  })
  sendOutbox(): Promise<void> {
    return this.development.sendOutbox();
  }

  @Public()
  @Post('plans/:planKey/offer')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Development only: put a plan on sale at a price',
    description: `${DEVELOPMENT_ONLY} The production seed leaves every paid plan off at a price of 0.`,
  })
  offerPlan(@Param('planKey') planKey: string, @Body() dto: OfferPlanDto): Promise<void> {
    return this.development.offerPlan(planKey, BigInt(dto.priceMinor));
  }
}
