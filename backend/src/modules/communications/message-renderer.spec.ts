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
});
