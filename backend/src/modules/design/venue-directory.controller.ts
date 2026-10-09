import { Body, Controller, Param, Patch, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { RequirePermission } from '../../infra/auth/actor';
import { CreateVenueProfileDto, UpdateVenueProfileDto } from './dto/design.dto';
import { VenuesService } from './venues.service';

/**
 * The shared directory of halls, which every host reads and copies from.
 * Kept by Aveline staff: one customer writing to it would be writing to all.
 */
@ApiTags('design')
@Controller('venue-profiles')
export class VenueDirectoryController {
  constructor(private readonly venues: VenuesService) {}

  @RequirePermission('directory:manage')
  @Post()
  @ApiOperation({ summary: 'Add a hall to the shared directory (Aveline staff)' })
  create(@Body() dto: CreateVenueProfileDto) {
    return this.venues.createProfile(dto);
  }

  @RequirePermission('directory:manage')
  @Patch(':profileId')
  @ApiOperation({
    summary: 'Correct or retire a hall (Aveline staff)',
    description: 'isActive: false hides it from hosts; venues already copied from it keep their copy.',
  })
  update(@Param('profileId') profileId: string, @Body() dto: UpdateVenueProfileDto) {
    return this.venues.updateProfile(profileId, dto);
  }
}
