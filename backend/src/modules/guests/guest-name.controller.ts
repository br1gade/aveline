import { Body, Controller, Param, Patch } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Public } from '../../infra/auth/actor';
import { CorrectNameDto } from './dto/correct-name.dto';
import { GuestNameService } from './guest-name.service';

@ApiTags('guests')
@Controller('invitations/:slug/g/:guestToken/name')
export class GuestNameController {
  constructor(private readonly names: GuestNameService) {}

  @Public()
  @Patch()
  @ApiOperation({ summary: 'Correct only the personal link holder’s first and last names' })
  correct(@Param('slug') slug: string, @Param('guestToken') token: string, @Body() dto: CorrectNameDto) {
    return this.names.correct(slug, token, dto);
  }
}
