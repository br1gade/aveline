const LETTER = /\p{L}/u;

/**
 * Where the name stands as a word of its own: an unknown code such as "it" is not marked in
 * "Title". No lookbehind, which Safari reads only from 16.4.
 */
function wordAt(text: string, name: string): number {
  for (let at = text.indexOf(name); at >= 0; at = text.indexOf(name, at + 1)) {
    const before = text.charAt(at - 1);
    const after = text.charAt(at + name.length);
    if (!LETTER.test(before) && !LETTER.test(after)) return at;
  }
  return -1;
}

/**
 * A sentence that names a language, with the name marked in that language, so a screen reader says
 * "Русский" in Russian inside an Armenian label (WCAG 3.1.2, design PD-215). The sentence stays
 * translated as a whole; the name is found in it as it was put in, and a sentence without it is
 * shown as it is.
 */
export function LanguageMarked({ text, name, lang }: { text: string; name: string; lang: string }) {
  const at = wordAt(text, name);
  if (at < 0) return text;
  return (
    <>
      {text.slice(0, at)}
      <span lang={lang}>{name}</span>
      {text.slice(at + name.length)}
    </>
  );
}
