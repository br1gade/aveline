/**
 * Text that CSS sets in capitals. Browsers upper-case the Armenian ligature "և" as "ԵՒ", the old
 * spelling; modern Eastern Armenian writes "ԵՎ" (audit F-32, design PD-197). Spelling the ligature
 * out as "եվ" first lets `text-transform: uppercase` give "ԵՎ". Lower case is never shown for this
 * text, so nothing else changes. To be confirmed by a native reader (PD-9).
 */
export function capsSafe(text: string): string {
  return text.replaceAll('և', 'եվ');
}
