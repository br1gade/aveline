import { Injectable } from '@nestjs/common';
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

  /** Called when the platform reports a token as no longer deliverable. */
  async revoke(token: string): Promise<void> {
    await this.prisma.deviceToken.updateMany({
      where: { token, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }
}
