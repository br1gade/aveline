import { BlockType, MediaKind } from '@prisma/client';

/**
 * Which uploads a block can show.
 *
 * The music block plays audio and nothing else; every other block shows
 * pictures. Checked when media is attached rather than when the page renders,
 * so a host is told at the moment they make the mistake — an MP3 in the
 * gallery would otherwise be a broken image on four hundred phones.
 */
const IMAGE_KINDS: readonly MediaKind[] = [MediaKind.PHOTO, MediaKind.COVER, MediaKind.LOGO];

const ACCEPTED_KINDS: Partial<Record<BlockType, readonly MediaKind[]>> = {
  [BlockType.MUSIC]: [MediaKind.AUDIO],
};

export function acceptedKinds(type: BlockType): readonly MediaKind[] {
  return ACCEPTED_KINDS[type] ?? IMAGE_KINDS;
}

/** The first asset this block cannot show, described for the host — or null. */
export function blockMediaProblem(
  type: BlockType,
  assets: { id: string; kind: MediaKind }[],
): string | null {
  const accepted = acceptedKinds(type);
  const wrong = assets.find((asset) => !accepted.includes(asset.kind));
  if (!wrong) return null;

  const wants = type === BlockType.MUSIC ? 'audio' : 'images';
  return `assetIds: a ${type} block shows ${wants}; ${wrong.id} is ${wrong.kind}`;
}
