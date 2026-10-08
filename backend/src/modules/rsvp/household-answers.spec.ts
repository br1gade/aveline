import { membersProblem, newPartyMembers } from './household-answers';

describe('newPartyMembers', () => {
  const household = [
    { firstName: 'Armen', lastName: 'Petrosyan' },
    { firstName: 'Narek', lastName: null },
  ];

  it('keeps only names not already in the household', () => {
    const party = [{ firstName: 'narek ' }, { firstName: 'Ani', lastName: 'Hakobyan' }];
    expect(newPartyMembers(household, party)).toEqual([{ firstName: 'Ani', lastName: 'Hakobyan' }]);
  });

  it('adds a name repeated within one submission once', () => {
    expect(newPartyMembers(household, [{ firstName: 'Ani' }, { firstName: 'ANI' }])).toHaveLength(1);
  });

  it('treats a different surname as a different person', () => {
    expect(newPartyMembers(household, [{ firstName: 'Armen', lastName: 'Sargsyan' }])).toHaveLength(1);
  });
});

describe('membersProblem', () => {
  const household = new Set(['armen', 'lusine', 'narek']);

  it('accepts members of the household other than the respondent', () => {
    expect(membersProblem(household, 'armen', ['lusine', 'narek'])).toBeNull();
  });

  it.each([
    [['armen'], /top-level status/],
    [['stranger'], /not in this household/],
    [['lusine', 'lusine'], /twice/],
  ])('refuses %p', (ids, message) => {
    expect(membersProblem(household, 'armen', ids)).toMatch(message);
  });
});
