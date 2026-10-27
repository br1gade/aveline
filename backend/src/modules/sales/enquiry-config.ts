import { NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { IntentKeyring } from './enquiry-intent';

export function intakeKeys(config: ConfigService): IntentKeyring {
  const current = config.get<string>('SALES_INTENT_HMAC_KEY_ID') ?? '';
  const keys = JSON.parse(config.get<string>('SALES_INTENT_HMAC_KEYS') ?? '{}') as Record<string, string>;
  if (!/^[a-zA-Z0-9_-]{1,32}$/.test(current) || typeof keys[current] !== 'string' || keys[current].length < 32) throw new Error('Intake intent key configuration is required');
  return { current, keys };
}

export function assertIntakeEnabled(config: ConfigService): void {
  if (config.get<string>('SALES_INTAKE_ENABLED') !== 'true') throw new NotFoundException('Not found');
}
