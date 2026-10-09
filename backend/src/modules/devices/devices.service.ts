import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { RegisterDeviceDto } from './dto/register-device.dto';

@Injectable()
export class DevicesService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Registers a device for push.
   *
   * Upsert rather than create: platforms reissue tokens, and the same device
   * re-registering must not accumulate rows — each duplicate would deliver
   * the same notification again. Re-registering also clears a prior
   * revocation, which is what reinstalling an app looks like.
   *
   * A token already registered to another account moves to this one. Only
   * the device itself can produce its token, so presenting it is that device
   * signed in as someone else — and the last account signed in is the one
   * whose notifications it should show.
   */
  register(userId: string, dto: RegisterDeviceDto) {
    const details = {
      platform: dto.platform,
      appVersion: dto.appVersion ?? null,
      locale: dto.locale ?? null,
      lastSeenAt: new Date(),
      revokedAt: null,
    };

    return this.prisma.deviceToken.upsert({
      where: { token: dto.token },
      create: { userId, token: dto.token, ...details },
      update: { userId, ...details },
      select: { id: true, platform: true, lastSeenAt: true },
    });
  }

  /**
   * Stops sending to one of this account's own devices. Scoped to the caller:
   * any account could once revoke another's device by naming its token. A
   * token that is not theirs is not found, whoever holds it.
   */
  async revoke(userId: string, token: string): Promise<void> {
    const owned = await this.prisma.deviceToken.findFirst({ where: { token, userId }, select: { id: true } });
    if (!owned) throw new NotFoundException('No such device on this account');

    await this.prisma.deviceToken.updateMany({
      where: { id: owned.id, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }
}
