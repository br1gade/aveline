import { signatureAnswerProblem } from './acknowledgement-rules';
const typed = { statementVersionId: 'v1', method: 'TYPED', signerName: 'Anna', isAcknowledged: true, locale: 'en' };
describe('Acknowledgement declarations', () => {
  it.each([typed, { ...typed, method: 'DRAWN', assetId: 'own-upload' }, { ...typed, isRepresentative: true }])('accepts an explicit bounded declaration %#', (value) => {
    expect(signatureAnswerProblem(value)).toBeNull();
  });
  it.each([null, 'signed', { ...typed, isAcknowledged: false }, { ...typed, signerName: ' ' }, { ...typed, signerName: 'x'.repeat(201) },
    { ...typed, signerName: 'x\0' }, { ...typed, assetId: 'unexpected' }, { ...typed, method: 'DRAWN' }, { ...typed, method: 'OTHER' },
    { ...typed, isRepresentative: 'true' }, { ...typed, url: 'https://untrusted.test/signature' }, { ...typed, locale: '' }])('rejects incomplete or ambiguous declaration %#', (value) => {
    expect(signatureAnswerProblem(value)).toEqual(expect.any(String));
  });
});
