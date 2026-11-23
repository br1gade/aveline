import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { LanguageMarked } from './language-marked';

describe('LanguageMarked (WCAG 3.1.2, design PD-215)', () => {
  it('marks the language’s name in its own language, and leaves the sentence around it', () => {
    const { container } = render(
      <p>
        <LanguageMarked text="Անվանում՝ Русский" name="Русский" lang="ru" />
      </p>,
    );
    expect(container.textContent).toBe('Անվանում՝ Русский');
    expect(container.querySelector('span[lang="ru"]')?.textContent).toBe('Русский');
  });

  it('marks the name only where it stands as a word, never inside another (an unknown code)', () => {
    const { container } = render(
      <p>
        <LanguageMarked text="Title in it" name="it" lang="it" />
      </p>,
    );
    expect(container.innerHTML).toBe('<p>Title in <span lang="it">it</span></p>');
  });

  it('keeps a sentence that doesn’t contain the name as it is', () => {
    const { container } = render(
      <p>
        <LanguageMarked text="Name" name="Русский" lang="ru" />
      </p>,
    );
    expect(container.textContent).toBe('Name');
    expect(container.querySelector('span')).toBeNull();
  });
});
