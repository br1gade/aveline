import { TemplateConstraints, ThemeValidation, mergeTheme, validateTheme } from './theme';

/** Narrows a rejection to its reasons without an `if` around an expectation. */
function rejectionReasons(result: ThemeValidation): string[] {
  return result.isValid ? [] : result.errors;
}

describe('validateTheme', () => {
  const constraints: TemplateConstraints = {
    allowedFonts: ['Noto Serif Armenian', 'Mardoto'],
    palettes: [
      { name: 'blush', colors: ['#f5e1e0', '#b76e79'] },
      { name: 'olive', colors: ['#3f4b3b', '#c9d5b5'] },
    ],
  };

  const validate = (theme: Record<string, unknown>) => validateTheme(theme, constraints);

  it('accepts a theme built from what the template declares', () => {
    const result = validate({ headingFont: 'Mardoto', bodyFont: 'Mardoto', palette: 'olive' });

    expect(result.isValid).toBe(true);
  });

  it('accepts an empty theme', () => {
    expect(validate({}).isValid).toBe(true);
  });

  /**
   * The hole this closes: `allowedFonts` was published to clients and never
   * enforced, so any string reached the renderer.
   */
  it.each(['headingFont', 'bodyFont'])('rejects a %s the template does not ship', (field) => {
    const result = validate({ [field]: 'Comic Sans' });

    expect(result.isValid).toBe(false);
    expect(rejectionReasons(result)[0]).toContain(field);
    expect(rejectionReasons(result)[0]).toContain('Noto Serif Armenian');
  });

  it('rejects a palette the template does not define', () => {
    const result = validate({ palette: 'neon' });

    expect(result.isValid).toBe(false);
    expect(rejectionReasons(result)[0]).toContain('olive');
  });

  // Four changes at once should produce four rejections, not a queue of
  // requests each failing on the next problem.
  it('reports every problem, not only the first', () => {
    const result = validate({
      headingFont: 'Comic Sans',
      bodyFont: 'Papyrus',
      palette: 'neon',
      colors: ['not-a-colour'],
    });

    expect(result.isValid).toBe(false);
    expect(rejectionReasons(result)).toHaveLength(4);
  });

  describe('custom colours', () => {
    it.each(['#1a2b3c', '#FFFFFF', '#000000'])('accepts %s', (color) => {
      expect(validate({ colors: [color] }).isValid).toBe(true);
    });

    it.each(['#fff', 'red', '#12345', '#1234567', 'rgb(1,2,3)', '', '#12345g'])(
      'rejects %s',
      (color) => {
        expect(validate({ colors: [color] }).isValid).toBe(false);
      },
    );

    it.each([
      { label: 'one colour', count: 1, isValid: true },
      { label: 'eight colours', count: 8, isValid: true },
      { label: 'nine colours', count: 9, isValid: false },
    ])('with $label', ({ count, isValid }) => {
      const colors = Array.from({ length: count }, () => '#1a2b3c');

      expect(validate({ colors }).isValid).toBe(isValid);
    });

    // An empty array is a mistake, not a request to clear the palette.
    it('rejects an empty array and says to omit the field instead', () => {
      const result = validate({ colors: [] });

      expect(result.isValid).toBe(false);
      expect(rejectionReasons(result)[0]).toContain('omit');
    });

    it('ignores colours entirely when the field is absent', () => {
      expect(validate({ palette: 'blush' }).isValid).toBe(true);
    });
  });

  // A template with nothing declared can render nothing custom.
  it('rejects any font when the template declares none', () => {
    const result = validateTheme(
      { headingFont: 'Mardoto' },
      { allowedFonts: [], palettes: [] },
    );

    expect(result.isValid).toBe(false);
  });
});

describe('mergeTheme', () => {
  // Omitted means "leave as is": changing one font must not clear the palette.
  it('keeps what the update does not mention', () => {
    expect(mergeTheme({ palette: 'blush', bodyFont: 'Mardoto' }, { bodyFont: 'Noto' })).toEqual({
      palette: 'blush',
      bodyFont: 'Noto',
    });
  });

  /**
   * A validated DTO carries every declared field, so an omitted one arrives as
   * `undefined`. Merging that would clear the palette the host chose.
   */
  it('ignores keys explicitly set to undefined', () => {
    expect(
      mergeTheme({ palette: 'blush' }, { bodyFont: 'Noto', palette: undefined, colors: undefined }),
    ).toEqual({ palette: 'blush', bodyFont: 'Noto' });
  });

  it('adds what is new', () => {
    expect(mergeTheme({ palette: 'blush' }, { headingFont: 'Noto' })).toEqual({
      palette: 'blush',
      headingFont: 'Noto',
    });
  });

  it('leaves the current theme untouched', () => {
    const current = { palette: 'blush' };
    mergeTheme(current, { palette: 'olive' });

    expect(current).toEqual({ palette: 'blush' });
  });
});
