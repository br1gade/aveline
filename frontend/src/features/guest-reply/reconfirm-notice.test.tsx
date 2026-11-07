import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { render, screen } from '@testing-library/react';
import { I18nextProvider } from 'react-i18next';
import { describe, expect, it } from 'vitest';

import { createI18n } from '@/lib/i18n';

import { ReconfirmNotice } from './components/reconfirm-notice';
import type { ReplyRecord } from './types';

function show(needsReconfirmation: boolean) {
  const record = { attendance: { needsReconfirmation } } as ReplyRecord;
  return render(
    <I18nextProvider i18n={createI18n('en')}>
      <ReconfirmNotice record={record} />
    </I18nextProvider>,
  );
}

describe('asking a household to answer again (PD-154)', () => {
  it('says so once the hosts changed how guests reply', () => {
    show(true);
    expect(screen.getByText(/Please answer again/)).toBeInTheDocument();
  });

  it('says nothing otherwise', () => {
    const { container } = show(false);
    expect(container).toBeEmptyDOMElement();
  });

  it('is on the personal card, as well as in the form further down', () => {
    const route = readFileSync(
      join(import.meta.dirname, '../../routes/public/guest-invitation.tsx'),
      'utf8',
    );
    expect(route.slice(route.indexOf('renderPersonal = '))).toMatch(/<ReconfirmNotice record=/);
  });
});
