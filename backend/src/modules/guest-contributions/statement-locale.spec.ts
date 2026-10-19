import { describeStatement } from './acknowledgements.service';

describe('Statement locale fallback', () => {
  it('keeps a published request locale for signing while identifying the text fallback language', () => {
    const statement = describeStatement({ id: 'question', statementVersionId: 'version', required: true, prompt: { en: 'Venue rules' } }, 'hy', 'hy');
    expect(statement).toMatchObject({ locale: 'hy', statementLocale: 'en', prompt: 'Venue rules' });
  });
});
