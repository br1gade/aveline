/**
 * Which smaller copies a photo gets.
 *
 * Three widths cover the screens an invitation is read on: a phone, a phone
 * at high density or a tablet, and a laptop. A copy is only made smaller than
 * the original — enlarging adds bytes and no detail. WebP, because every
 * browser a guest uses reads it and it is a fraction of a JPEG's size.
 */
export const VARIANT_WIDTHS = [480, 960, 1600] as const;

/** Raster images that can be resized. SVG scales on its own; audio is not an image. */
export const RESIZABLE_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/avif'] as const;

export function variantWidths(originalWidth: number): number[] {
  return VARIANT_WIDTHS.filter((width) => width < originalWidth);
}

export interface ImageVariant {
  width: number;
  height: number;
  url: string;
  sizeBytes: number;
}
