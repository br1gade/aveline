import { BadRequestException } from '@nestjs/common';

export interface ContactInput { name?: string | null; email?: string | null; phone?: string | null }
export interface Contact { name: string; email: string | null; phone: string | null }

export function mergeContact(current: ContactInput | null, changes: ContactInput): Contact {
  const merged = { name: null, email: null, phone: null, ...current, ...changes };
  const name = merged.name?.trim() ?? '';
  const email = merged.email?.trim().toLowerCase() || null;
  const phone = merged.phone?.trim() || null;
  validateContact({ name, email, phone });
  return { name, email, phone };
}

function validateContact({ name, email, phone }: Contact): void {
  if (!name || name.length > 200) throw new BadRequestException('contact.name must be 1–200 characters');
  if (!email && !phone) throw new BadRequestException('contact requires email or phone');
  if (email && (email.length > 200 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))) throw new BadRequestException('contact.email must be valid');
  if (phone && !/^\+[1-9][0-9]{6,14}$/.test(phone)) throw new BadRequestException('contact.phone must be E.164');
}

export function addCalendarMonths(date: Date, months: number): Date {
  const due = new Date(date);
  const day = due.getUTCDate();
  due.setUTCDate(1);
  due.setUTCMonth(due.getUTCMonth() + months);
  const last = new Date(Date.UTC(due.getUTCFullYear(), due.getUTCMonth() + 1, 0)).getUTCDate();
  due.setUTCDate(Math.min(day, last));
  return due;
}

export function validateTimezone(timezone: string): void {
  try { new Intl.DateTimeFormat('en', { timeZone: timezone }).format(); }
  catch { throw new BadRequestException('timezone must be an IANA timezone'); }
}

export function validateConsultation(input: { startsAt: Date; endsAt: Date; timezone: string }): void {
  const duration = input.endsAt.getTime() - input.startsAt.getTime();
  if (!Number.isFinite(duration) || duration < 300000 || duration > 28800000) throw new BadRequestException('endsAt must be 5 minutes–8 hours after startsAt');
  validateTimezone(input.timezone);
}
