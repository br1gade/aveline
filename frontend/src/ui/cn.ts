import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

/**
 * Joins class names and lets a later Tailwind class win over an earlier one, as the shadcn/ui kit
 * in `kit/` expects. The invitation keeps the simpler `cx`.
 */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
