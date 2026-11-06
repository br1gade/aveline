import { Controller, Get, Header, Res, UseInterceptors } from '@nestjs/common';
import { ApiProduces } from '@nestjs/swagger';
import { JobRecoveryInterceptor } from './interceptors/job-recovery.interceptor';
import { responseTransportFor } from './openapi-response-transport';

@Controller('transport')
@UseInterceptors(JobRecoveryInterceptor)
class TransportController {
  @Get('json') json(@Res({ passthrough: true }) _response: unknown) { return { state: 'PROCESSING' }; }
  @Get('raw') raw(@Res() _response: unknown) {}
  @Get('file') @ApiProduces('text/csv', 'application/pdf') file() {}
  @Get('challenge') @Header('Content-Type', 'text/plain') challenge() { return '123'; }
}

describe('response transport comes from the actual Nest metadata', () => {
  it('distinguishes status-setting passthrough responses from raw responses', () => {
    expect(responseTransportFor(TransportController, 'json').isRaw).toBe(false);
    expect(responseTransportFor(TransportController, 'raw').isRaw).toBe(true);
  });
  it('preserves declared download MIME types and explicit text responses', () => {
    expect(responseTransportFor(TransportController, 'file').mediaTypes).toEqual(['text/csv', 'application/pdf']);
    expect(responseTransportFor(TransportController, 'challenge').mediaTypes).toEqual(['text/plain']);
  });
  it('includes the recovery interceptor inherited from the controller', () => {
    expect(responseTransportFor(TransportController, 'json').hasJobRecovery).toBe(true);
  });
});
