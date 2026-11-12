import { ApiProperty } from '@nestjs/swagger';
import { IsIn } from 'class-validator';

export const FAKE_BANK_OUTCOMES = ['PAID', 'DECLINED'] as const;
export type FakeBankOutcome = (typeof FAKE_BANK_OUTCOMES)[number];

export class FakeBankAnswerDto {
  @ApiProperty({ enum: FAKE_BANK_OUTCOMES, description: 'What the payer did at the fake bank' })
  @IsIn(FAKE_BANK_OUTCOMES)
  outcome!: FakeBankOutcome;
}
