import { issuanceStatus } from './issuance-status';

describe('Attendance projection at ticket issuance', () => {
  const attendee = { attendanceRevision: 2, status: 'DECLINED' as const, venueAttendance: [{ venueId: 'hall', status: 'DECLINED' }] };
  it('keeps a newly added venue pending, preserving the old venue decline', () => {
    expect(issuanceStatus({ attendanceMode: 'PER_VENUE', attendanceRevision: 2, venues: [{ id: 'hall' }, { id: 'church' }] }, attendee)).toBe('PENDING');
  });
  it('requires reconfirmation for an older policy revision', () => {
    expect(issuanceStatus({ attendanceMode: 'EVENT_WIDE', attendanceRevision: 3, venues: [] }, attendee)).toBe('PENDING');
  });
  it('preserves an explicit event-wide answer under the same policy', () => {
    expect(issuanceStatus({ attendanceMode: 'EVENT_WIDE', attendanceRevision: 2, venues: [] }, attendee)).toBe('DECLINED');
  });
});
