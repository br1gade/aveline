import type { BlockMedia } from '../types';

export interface ImageSource {
  src: string;
  srcSet?: string;
  width?: number;
  height?: number;
}

/**
 * `src`, `srcSet` and the intrinsic size of a photograph (docs/API.md, "Uploading a file"): the
 * smaller copies the backend makes after upload, then the original, so a phone downloads the copy
 * its screen needs. Until the copies exist only the original is offered.
 */
export function imageSource(media: BlockMedia): ImageSource {
  const sizes = (media.variants ?? []).map((variant) => ({
    url: variant.url,
    width: variant.width,
  }));
  if (media.width) sizes.push({ url: media.url, width: media.width });
  const candidates = sizes.toSorted((a, b) => a.width - b.width);
  return {
    src: media.url,
    ...(candidates.length > 1
      ? { srcSet: candidates.map((size) => `${size.url} ${size.width}w`).join(', ') }
      : {}),
    ...(media.width && media.height ? { width: media.width, height: media.height } : {}),
  };
}
