import { assertPlanFits } from './seating-plan-validation';
import { SeatingInput } from './seating-input';
import { SeatingPlan } from '../seating-plan';

const input: SeatingInput = { attendanceRevision: 1, arrangementRevision: 1, availableSeats: 2,
  households: [{ householdId: 'family', guestIds: ['a', 'b'], side: 'SIDE_A', seatedAt: ['one'] }],
  tables: [{ tableId: 'one', capacity: 3, occupied: 1, side: null }, { tableId: 'two', capacity: 3, occupied: 0, side: null }] };
const plan = (): SeatingPlan => ({ assignments: [{ householdId: 'family', tableId: 'one', guestIds: ['a', 'b'] }], unseated: [] });
describe('Worker plan application constraints', () => {
  it('accepts a whole eligible household within table and venue budgets', () => { expect(() => assertPlanFits(input, plan())).not.toThrow(); });
  it.each(['split', 'foreign guest', 'duplicate guest', 'duplicate', 'wrong family table', 'table capacity', 'venue capacity'] as const)('rejects %s before writing any seats', (kind) => {
    const captured = structuredClone(input);
    const candidate = plan();
    const mutations = {
      split: () => { candidate.assignments[0].guestIds = ['a']; },
      'foreign guest': () => { candidate.assignments[0].guestIds = ['a', 'stranger']; },
      'duplicate guest': () => { candidate.assignments[0].guestIds = ['a', 'b', 'b']; },
      duplicate: () => { candidate.assignments.push(candidate.assignments[0]); },
      'wrong family table': () => { candidate.assignments[0].tableId = 'two'; },
      'table capacity': () => { captured.tables[0].capacity = 2; },
      'venue capacity': () => { captured.availableSeats = 1; },
    };
    mutations[kind]();
    expect(() => assertPlanFits(captured, candidate)).toThrow('INVALID_PLAN');
  });
});
