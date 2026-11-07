/**
 * Finding a guest by name whatever alphabet it was typed in (design PD-44, PD-90). Door staff type
 * on a phone's Latin keyboard, and names are often in Armenian or Russian, so each name also
 * carries its Latin form, and each word typed is tried as itself and in Latin. One common spelling
 * per letter: Armenian as in passports, Russian as usually typed (`yu`, `ya`, `y` for `й`), not as
 * in passports (`iu`, `ia`, `i`). Spelling variants ("Hakobian" for "Hakobyan") are not matched.
 */

const MARKS = /\p{M}/gu;

/** `й` decomposed, so that it can be kept: in Latin it is `y`, not the `i` of `и`. */
const SHORT_I = /и\u0306/gu;

/** Case and accents ignored, in every script: "Пётр" finds "Петр", "ANI" finds "Ani". */
export function normalizeName(text: string): string {
  return text.normalize('NFKD').replace(MARKS, '').toLowerCase();
}

/** Two letters read as one, before the one-letter table. `և` becomes `եւ` when normalised. */
const PAIRS: Readonly<Record<string, string>> = { ու: 'u', եւ: 'ev' };

/** At a word's start, as in Yerevan and Voskanyan. */
const WORD_FIRST: Readonly<Record<string, string>> = { ե: 'ye', ո: 'vo' };

const ARMENIAN: Readonly<Record<string, string>> = {
  ա: 'a',
  բ: 'b',
  գ: 'g',
  դ: 'd',
  ե: 'e',
  զ: 'z',
  է: 'e',
  ը: 'y',
  թ: 't',
  ժ: 'zh',
  ի: 'i',
  լ: 'l',
  խ: 'kh',
  ծ: 'ts',
  կ: 'k',
  հ: 'h',
  ձ: 'dz',
  ղ: 'gh',
  ճ: 'ch',
  մ: 'm',
  յ: 'y',
  ն: 'n',
  շ: 'sh',
  ո: 'o',
  չ: 'ch',
  պ: 'p',
  ջ: 'j',
  ռ: 'r',
  ս: 's',
  վ: 'v',
  տ: 't',
  ր: 'r',
  ց: 'ts',
  ւ: 'v',
  փ: 'p',
  ք: 'k',
  օ: 'o',
  ֆ: 'f',
};

/** `ё` loses its mark when normalised, so it is read as `е`. */
const CYRILLIC: Readonly<Record<string, string>> = {
  а: 'a',
  б: 'b',
  в: 'v',
  г: 'g',
  д: 'd',
  е: 'e',
  ж: 'zh',
  з: 'z',
  и: 'i',
  й: 'y',
  к: 'k',
  л: 'l',
  м: 'm',
  н: 'n',
  о: 'o',
  п: 'p',
  р: 'r',
  с: 's',
  т: 't',
  у: 'u',
  ф: 'f',
  х: 'kh',
  ц: 'ts',
  ч: 'ch',
  ш: 'sh',
  щ: 'shch',
  ъ: '',
  ы: 'y',
  ь: '',
  э: 'e',
  ю: 'yu',
  я: 'ya',
};

const LETTERS: Readonly<Record<string, string>> = { ...ARMENIAN, ...CYRILLIC };

const LETTER = /\p{L}/u;

function isWordStart(chars: readonly string[], index: number): boolean {
  const before = chars[index - 1];
  return before === undefined || !LETTER.test(before);
}

/** A name in Latin letters, normalised; anything not Armenian or Cyrillic is kept as it is. */
export function latinOf(name: string): string {
  const folded = name.normalize('NFKD').toLowerCase().replace(SHORT_I, 'й').replace(MARKS, '');
  const chars = [...folded];
  let latin = '';
  for (let index = 0; index < chars.length; index += 1) {
    const char = chars[index] ?? '';
    const pair = PAIRS[char + (chars[index + 1] ?? '')];
    if (pair !== undefined) {
      latin += pair;
      index += 1;
      continue;
    }
    const first = isWordStart(chars, index) ? WORD_FIRST[char] : undefined;
    latin += first ?? LETTERS[char] ?? char;
  }
  return latin;
}

/**
 * What a name is searched in: itself, normalised, and its Latin form when that differs. A newline
 * parts them, which a search box can't hold, so a phrase never matches across the two.
 */
export function nameKey(name: string): string {
  const normalized = normalizeName(name);
  const latin = latinOf(name);
  return latin === normalized ? normalized : `${normalized}\n${latin}`;
}

/** What a typed word is looked for as: itself, and its Latin form when that differs. */
export function queryForms(typed: string): string[] {
  const normalized = normalizeName(typed);
  const latin = latinOf(typed);
  return latin === normalized ? [normalized] : [normalized, latin];
}

/** Whether a key, from `nameKey`, holds any form of what was typed, from `queryForms`. */
export function isFoundIn(key: string, forms: readonly string[]): boolean {
  return forms.some((form) => key.includes(form));
}
