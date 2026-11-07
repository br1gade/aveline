import { z } from 'zod';

import { isEmailShaped } from '@/lib/text';

import { toMinor } from '@/lib/money';

import { BRIEF_SECTIONS, CHOOSABLE_STATUSES, VENDOR_CATEGORIES } from './scopes';
import type { VendorCategory } from './types';

/** Messages are codes, worded by the forms; the limits are `vendor.dto.ts`'s. */
export type VendorFieldCode =
  'required' | 'nameShort' | 'tooLong' | 'email' | 'fee' | 'feeTooLarge' | 'cantClear';

/** The backend takes at most 15 digits of minor units (`feeMinor`, `^\d{1,15}$`). */
const FEE_DIGITS = 15;

/** A fee as typed: empty is none; otherwise whole minor units the backend will take. */
export function feeProblem(input: string, currency: string): VendorFieldCode | null {
  if (!input.trim()) return null;
  try {
    return toMinor(input, currency).length > FEE_DIGITS ? 'feeTooLarge' : null;
  } catch {
    return 'fee';
  }
}

const sections = z.array(z.enum(BRIEF_SECTIONS));

export const vendorFormSchema = z.object({
  name: z.string().trim().min(2, 'nameShort').max(160, 'tooLong'),
  category: z
    .string()
    .refine((value) => (VENDOR_CATEGORIES as string[]).includes(value), 'required')
    .transform((value) => value as VendorCategory),
  email: z
    .string()
    .trim()
    .max(200, 'tooLong')
    .refine((value) => !value || isEmailShaped(value), 'email'),
  phone: z.string().trim().max(40, 'tooLong'),
});

export type VendorFormValues = z.input<typeof vendorFormSchema>;
export type VendorFormOutput = z.output<typeof vendorFormSchema>;

/** The fee is typed in the booking's currency, AMD until FR-106 lets one be chosen. */
function feeField(currency: string) {
  return z.string().superRefine((value, context) => {
    const problem = feeProblem(value, currency);
    if (problem) context.addIssue({ code: 'custom', message: problem });
  });
}

export function bookingFormSchema(currency: string) {
  return z.object({
    vendorId: z.string().min(1, 'required'),
    scopes: sections,
    fee: feeField(currency),
  });
}

export type BookingFormValues = z.infer<ReturnType<typeof bookingFormSchema>>;

/**
 * A fee once agreed can be changed but not removed: the backend has no way to clear it (FR-106),
 * so an emptied field is refused here rather than silently kept.
 */
export function bookingEditSchema(currency: string, hasFee: boolean) {
  return z.object({
    status: z.enum(CHOOSABLE_STATUSES),
    scopes: sections,
    fee: feeField(currency).refine((value) => !hasFee || value.trim() !== '', 'cantClear'),
  });
}

export type BookingEditValues = z.infer<ReturnType<typeof bookingEditSchema>>;
