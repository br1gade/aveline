import { RsvpStatus } from '@prisma/client';
import { summarizeAttendance } from './attendance-summary';

describe('Attendance across eligible venues', () => {
  it.each([
    { answers: [], venues: ['hall'], status: 'PENDING' },
    { answers: [{ venueId: 'hall', status: 'DECLINED' }], venues: ['hall', 'church'], status: 'PENDING' },
    { answers: [{ venueId: 'hall', status: 'ATTENDING' }], venues: ['hall', 'church'], status: 'ATTENDING' },
    { answers: [{ venueId: 'hall', status: 'DECLINED' }, { venueId: 'church', status: 'UNDECIDED' }], venues: ['hall', 'church'], status: 'UNDECIDED' },
    { answers: [{ venueId: 'hall', status: 'DECLINED' }, { venueId: 'church', status: 'DECLINED' }], venues: ['hall', 'church'], status: 'DECLINED' },
    { answers: [{ venueId: 'internal', status: 'ATTENDING' }, { venueId: 'hall', status: 'DECLINED' }], venues: ['hall'], status: 'DECLINED' },
    { answers: [], venues: [], status: 'PENDING' },
  ])('summarizes $answers over $venues as $status without guessing unanswered venues', ({ answers, venues, status }) => {
    expect(summarizeAttendance(venues, answers as { venueId: string; status: RsvpStatus }[])).toBe(status);
  });
});
