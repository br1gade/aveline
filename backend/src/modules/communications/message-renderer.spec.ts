import { renderTemplate } from './message-renderer';

/**
 * Rendering happens once, at enqueue, and the result is stored. So a template
 * change never rewrites what was already sent — and a missing variable must
 * never reach a guest as "Dear {{name}}".
 */
describe('renderTemplate', () => {
  it('substitutes the variables it is given', () => {
    expect(renderTemplate('Dear {{name}}, see you on {{date}}.', { name: 'Ani', date: '5 June' })).toBe(
      'Dear Ani, see you on 5 June.',
    );
  });

  it('tolerates whitespace inside the braces', () => {
    expect(renderTemplate('Hi {{ name }}', { name: 'Ani' })).toBe('Hi Ani');
  });

  it('substitutes every occurrence, not just the first', () => {
    expect(renderTemplate('{{a}} and {{a}}', { a: 'x' })).toBe('x and x');
  });

  it('refuses to render when a variable is missing, naming it', () => {
    expect(() => renderTemplate('Dear {{name}}', {})).toThrow(/name/);
  });

  it('treats an empty string as a supplied value', () => {
    expect(renderTemplate('[{{note}}]', { note: '' })).toBe('[]');
  });

  it('leaves text with no placeholders untouched', () => {
    expect(renderTemplate('No variables here', {})).toBe('No variables here');
  });

  it('does not re-scan substituted values, so data cannot inject a placeholder', () => {
    expect(renderTemplate('{{a}}', { a: '{{b}}' })).toBe('{{b}}');
  });

  // B72: the invitation offers Telegram only when a bot exists; the wording
  // stays in the copy, not in code.
  describe('optional sections', () => {
    const copy = 'Hello.{{#telegramLink}} Prefer Telegram? {{telegramLink}}{{/telegramLink}}';

    it('keeps a section whose variable has a value', () => {
      expect(renderTemplate(copy, { telegramLink: 'https://t.me/bot?start=x' })).toBe(
        'Hello. Prefer Telegram? https://t.me/bot?start=x',
      );
    });

    it('drops a section whose variable is empty', () => {
      expect(renderTemplate(copy, { telegramLink: '' })).toBe('Hello.');
    });

    it('still refuses a section whose variable was never given', () => {
      expect(() => renderTemplate(copy, {})).toThrow(/telegramLink/);
    });
  });
});
