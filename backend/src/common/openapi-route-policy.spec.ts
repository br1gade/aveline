import { Controller, Get } from '@nestjs/common';
import { EventScope, OrganizationScope, Public } from '../infra/auth/actor';
import { routePolicyFor } from './openapi-route-policy';

@Controller('example')
@EventScope('eventId')
class ScopedController {
  @Get() protectedRead() {}
  @Public() @Get('public') publicRead() {}
}
@Controller('organization')
class OrganizationController {
  @OrganizationScope() @Get() scoped() {}
  @Get('session') sessionOnly() {}
}

describe('the schema describes the guard metadata', () => {
  it('uses inherited resource scope and bearer authentication for a protected read', () => {
    expect(routePolicyFor(ScopedController, ScopedController.prototype.protectedRead)).toEqual({ isPublic: false, isOrganizationSelectable: true });
  });
  it('does not advertise organization selection on a public capability read', () => {
    expect(routePolicyFor(ScopedController, ScopedController.prototype.publicRead)).toEqual({ isPublic: true, isOrganizationSelectable: false });
  });
  it('distinguishes organization-scoped routes from session-only routes', () => {
    expect(routePolicyFor(OrganizationController, OrganizationController.prototype.scoped).isOrganizationSelectable).toBe(true);
    expect(routePolicyFor(OrganizationController, OrganizationController.prototype.sessionOnly).isOrganizationSelectable).toBe(false);
  });
});
