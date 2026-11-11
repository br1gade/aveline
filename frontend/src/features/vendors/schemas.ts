import { z } from 'zod';

import { isEmailShaped } from '@/lib/text';

import { toMinor } from '@/lib/money';

import { BRIEF_SECTIONS, CHOOSABLE_STATUSES, isVendorCategory } from './scopes';

/** Messages are codes, worded by the forms; the limits are `vendor.dto.ts`'s. */
export type VendorFieldCode =
  'required' | 'nameShort' | 'tooLong' | 'email' | 'fee' | 'feeTooLarge';

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

/** At most what `vendor.dto.ts` takes for a vendor's notes. */
export const NOTES_LIMIT = 2000;

export const vendorFormSchema = z.object({
  name: z.string().trim().min(2, 'nameShort').max(160, 'tooLong'),
  category: z.string().refine(isVendorCategory, 'required'),
  email: z
    .string()
    .trim()
    .max(200, 'tooLong')
    .refine((value) => !value || isEmailShaped(value), 'email'),
  phone: z.string().trim().max(40, 'tooLong'),
  notes: z.string().trim().max(NOTES_LIMIT, 'tooLong'),
});

export type VendorFormValues = z.input<typeof vendorFormSchema>;
export type VendorFormOutput = z.output<typeof vendorFormSchema>;

/** The fee is checked in the currency chosen beside it, whose decimals differ (FR-106). */
function withFeeChecked<T extends z.ZodType<{ fee: string; currency: string }>>(schema: T) {
  return schema.superRefine((values, context) => {
    const problem = feeProblem(values.fee, values.currency);
    if (problem) context.addIssue({ code: 'custom', path: ['fee'], message: problem });
  });
}

const currency = z.string().regex(/^[A-Z]{3}$/, 'required');

export const bookingFormSchema = withFeeChecked(
  z.object({
    vendorId: z.string().min(1, 'required'),
    scopes: sections,
    fee: z.string(),
    currency,
  }),
);

export type BookingFormValues = z.infer<typeof bookingFormSchema>;

/** An emptied fee clears it (FR-106). */
export const bookingEditSchema = withFeeChecked(
  z.object({ status: z.enum(CHOOSABLE_STATUSES), scopes: sections, fee: z.string(), currency }),
);

export type BookingEditValues = z.infer<typeof bookingEditSchema>;
