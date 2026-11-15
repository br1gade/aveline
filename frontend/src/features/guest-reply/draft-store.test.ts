import { afterEach, describe, expect, it } from 'vitest';

import { replyDraftStore } from './draft-store';
import { initialValues } from './form-model';
import { QUESTIONS, recordWith } from './test-data';

const { signatures: _left, ...values } = initialValues(recordWith(), QUESTIONS);

afterEach(() => window.sessionStorage.clear());

describe('replyDraftStore (design PD-195)', () => {
  it('keeps a reply in progress for this invitation and guest, until cleared', () => {
    const store = replyDraftStore('anna-davit', 'g1');
    store.write({ revision: 3, values: { ...values, message: 'See you there' } });
    expect(replyDraftStore('anna-davit', 'g1').read()).toMatchObject({
      revision: 3,
      values: { message: 'See you there' },
    });
    expect(replyDraftStore('anna-davit', 'g2').read()).toBeNull();
    store.clear();
    expect(store.read()).toBeNull();
  });

  it('stores no token, and nothing but the reply', () => {
    replyDraftStore('anna-davit', 'g1').write({ revision: 1, values });
    const [key] = Object.keys(window.sessionStorage);
    expect(key).toBe('aveline-reply-draft:anna-davit:g1');
    expect(window.sessionStorage.getItem(key ?? '')).not.toContain('signatures');
  });

  it('ignores anything stored that is not a reply in progress', () => {
    window.sessionStorage.setItem('aveline-reply-draft:anna-davit:g1', '{"revision":1}');
    expect(replyDraftStore('anna-davit', 'g1').read()).toBeNull();
    window.sessionStorage.setItem('aveline-reply-draft:anna-davit:g1', 'not json');
    expect(replyDraftStore('anna-davit', 'g1').read()).toBeNull();
  });
});
