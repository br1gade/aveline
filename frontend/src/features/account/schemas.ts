import { z } from 'zod';

/**
 * The forms' checks, with the backend's own limits (backend/src/infra/auth/dto), so a refusal is
 * rare. The server stays the authority. Messages are codes, worded by `useFieldText`.
 */
export type FieldCode = 'required' | 'email' | 'passwordShort' | 'nameShort' | 'tooLong';

const required = (limit: number) =>
  z
    .string()
    .trim()
    .min(1, { error: 'required' satisfies FieldCode, abort: true })
    .max(limit, { error: 'tooLong' satisfies FieldCode });

const email = required(200).pipe(z.email({ error: 'email' satisfies FieldCode }));

/** Not trimmed: a password is exactly what was typed. */
const password = z
  .string()
  .min(1, { error: 'required' satisfies FieldCode, abort: true })
  .min(10, { error: 'passwordShort' satisfies FieldCode })
  .max(200, { error: 'tooLong' satisfies FieldCode });

const personName = required(120).pipe(
  z.string().min(2, { error: 'nameShort' satisfies FieldCode }),
);

export const signInSchema = z.object({ email, password });
export type SignInValues = z.infer<typeof signInSchema>;

export const registerSchema = z.object({ name: personName, email, password });
export type RegisterValues = z.infer<typeof registerSchema>;

export const resetRequestSchema = z.object({ email });
export type ResetRequestValues = z.infer<typeof resetRequestSchema>;

export const newPasswordSchema = z.object({ password });
export type NewPasswordValues = z.infer<typeof newPasswordSchema>;

/** `name` is required even when the address already has an account, which ignores it (FR-23). */
export const acceptInviteSchema = z.object({ name: personName, password });
export type AcceptInviteValues = z.infer<typeof acceptInviteSchema>;

export const organizationSchema = z.object({
  name: required(160).pipe(z.string().min(2, { error: 'nameShort' satisfies FieldCode })),
  kind: z.enum(['HOST', 'PLANNER', 'CORPORATE']),
});
export type OrganizationValues = z.infer<typeof organizationSchema>;
