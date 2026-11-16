import { act, render, screen } from '@testing-library/react';
import { I18nextProvider } from 'react-i18next';
import { describe, expect, it } from 'vitest';

import type { Problem } from '@/api/problems';
import { createI18n } from '@/lib/i18n';

import { ProblemAlert } from './problem-alert';

function alertFor(problem: Problem) {
  return (
    <I18nextProvider i18n={createI18n('en')}>
      <ProblemAlert problem={problem} refused={() => 'Refused'} />
    </I18nextProvider>
  );
}

function show(problem: Problem) {
  return render(alertFor(problem));
}

const backOnline = () =>
  act(() => {
    window.dispatchEvent(new Event('online'));
  });

describe('a problem’s alert (audit F-35)', () => {
  it('says the connection is back once the browser is online again', () => {
    show({ code: 'unreachable' });
    expect(screen.getByRole('alert')).toHaveTextContent('We couldn’t reach Aveline');
    backOnline();
    expect(screen.getByRole('alert')).toHaveTextContent('You’re connected again. Try again.');
  });

  it('starts over for a new failure after the connection came back', () => {
    const { rerender } = show({ code: 'unreachable' });
    backOnline();
    rerender(alertFor({ code: 'unreachable' }));
    expect(screen.getByRole('alert')).toHaveTextContent('We couldn’t reach Aveline');
  });

  it.each<[Problem, string]>([
    [{ code: 'rate-limited' }, 'Too many attempts'],
    [{ code: 'server', requestId: 'r-1' }, 'r-1'],
  ])('keeps any other problem’s words when the browser comes online: %o', (problem, words) => {
    show(problem);
    backOnline();
    expect(screen.getByRole('alert')).toHaveTextContent(words);
    expect(screen.getByRole('alert')).not.toHaveTextContent('connected again');
  });
});
