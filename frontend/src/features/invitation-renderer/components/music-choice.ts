/**
 * The guest's music choice, for this tab's session (spec §10, design PD-143). It holds only on or
 * off: no link, slug or token. Where the browser refuses storage it is simply not remembered.
 */
const STORAGE_KEY = 'aveline-music';

export type MusicChoice = 'on' | 'off';

export function rememberMusic(choice: MusicChoice): void {
  try {
    window.sessionStorage.setItem(STORAGE_KEY, choice);
  } catch {
    // Not remembered, which only means pressing again.
  }
}

export function rememberedMusic(): MusicChoice | null {
  try {
    const stored = window.sessionStorage.getItem(STORAGE_KEY);
    return stored === 'on' || stored === 'off' ? stored : null;
  } catch {
    return null;
  }
}
