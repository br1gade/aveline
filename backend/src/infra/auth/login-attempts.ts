import { Inject, Injectable } from '@nestjs/common';
import { createHash } from 'node:crypto';
import type Redis from 'ioredis';
import { DomainHttpException } from '../../common/domain-http.exception';
import { REDIS_CLIENT } from '../cache/cache.service';

/** Failed sign-ins one account may take within the window before it waits. */
export const LOGIN_FAILURE_LIMIT = 10;
const WINDOW_SECONDS = 15 * 60;

/**
 * Failed sign-ins counted per account, beside the per-address limit, which a
 * script spread over many addresses never reaches.
 *
 * A wait, not a lock: anyone who knows an address could otherwise keep its
 * owner out. Password reset is not counted, so the owner always has a way in.
 * Redis down means no count, never a refused sign-in.
 */
@Injectable()
export class LoginAttempts {
  constructor(@Inject(REDIS_CLIENT) private readonly redis: Redis) {}

  async assertAllowed(email: string): Promise<void> {
    const failures = Number(await this.redis.get(keyFor(email)).catch(() => null));
    if (failures >= LOGIN_FAILURE_LIMIT) {
      throw new DomainHttpException('LOGIN_TOO_MANY_ATTEMPTS', 'email: too many failed sign-ins; try again in 15 minutes or reset the password');
    }
  }

  async recordFailure(email: string): Promise<void> {
    const key = keyFor(email);
    // NX: the window runs from the first failure, so it ends however fast the attempts come.
    await this.redis.multi().incr(key).expire(key, WINDOW_SECONDS, 'NX').exec().catch(() => undefined);
  }

  async recordSuccess(email: string): Promise<void> {
    await this.redis.del(keyFor(email)).catch(() => undefined);
  }
}

/** Hashed, so Redis holds no list of the addresses people sign in with. */
const keyFor = (email: string) => `login-failures:${createHash('sha256').update(email).digest('hex')}`;
