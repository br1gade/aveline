import { storedImportDiagnostic, storedImportDiagnostics } from './import-diagnostics';

describe('durable import diagnostics', () => {
  it.each([
    { row: 2, reason: 'INVALID_SEATS', field: 'seats', value: 'person@example.test', message: 'raw input' },
    { row: 3, reason: 'HOUSEHOLD_FULL', field: 'seats', message: 'Could not save person@example.test' },
    { row: 0, message: 'Columns found: person@example.test', value: '+37499123456' },
    { row: 2, reason: 'person@example.test', field: 'person@example.test', message: 'person@example.test' },
  ])('keeps safe row context while discarding arbitrary values in %p', (input) => {
    const result = storedImportDiagnostic(input);
    expect(result.row).toBe(input.row);
    expect(JSON.stringify(result)).not.toMatch(/person@example|37499123456|raw input|Columns found/);
    expect(result).not.toHaveProperty('value');
  });

  it.each([null, 'old diagnostic', {}, [null]])('handles malformed historical diagnostics %p without exposing them', (input) => {
    expect(storedImportDiagnostics(input).every((row) => row.row === 0 && row.message === 'This row could not be imported')).toBe(true);
  });
});
