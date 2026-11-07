import { encode } from 'uqr';

/** The clear margin a scanner needs, in the code's own squares. */
const QUIET_ZONE = 4;

export interface QrDrawing {
  /** Squares across, with the margin. */
  size: number;
  path: string;
}

function darkRuns(row: readonly boolean[]): Array<[start: number, width: number]> {
  const runs: Array<[number, number]> = [];
  row.forEach((isDark, x) => {
    if (!isDark) return;
    const last = runs.at(-1);
    if (last && last[0] + last[1] === x) last[1] += 1;
    else runs.push([x, 1]);
  });
  return runs;
}

/**
 * A code as one SVG path (design PD-171): no canvas and no image address, so it is safe to render anywhere,
 * and nothing but this page ever holds it. Medium error correction, for a phone's scratched screen.
 */
export function qrDrawing(text: string): QrDrawing {
  const { data, size } = encode(text, { ecc: 'M', border: 0 });
  const path = data
    .flatMap((row, y) =>
      darkRuns(row).map(
        ([x, width]) => `M${x + QUIET_ZONE} ${y + QUIET_ZONE}h${width}v1h-${width}z`,
      ),
    )
    .join('');
  return { size: size + QUIET_ZONE * 2, path };
}
