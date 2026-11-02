import { EnquiryContactDto } from './dto/enquiry.dto';
import { addCalendarMonths, mergeContact, validateConsultation } from './enquiry-rules';

describe('enquiry contact and retention rules', () => {
  it.each([
    ['2026-08-31T12:45:00.000Z', '2027-02-28T12:45:00.000Z'],
    ['2027-08-31T12:45:00.000Z', '2028-02-29T12:45:00.000Z'],
    ['2026-10-26T00:00:00.000Z', '2027-04-26T00:00:00.000Z'],
  ])('clamps six calendar months from %s', (closedAt, dueAt) => {
    expect(addCalendarMonths(new Date(closedAt), 6).toISOString()).toBe(dueAt);
  });
  it('normalizes merged contact without losing omitted fields', () => {
    expect(mergeContact({ name: 'Anna', email: 'anna@example.am', phone: '+37499123456' }, { email: null })).toEqual({ name: 'Anna', email: null, phone: '+37499123456' });
    expect(mergeContact(null, { name: ' Anna ', email: 'ANNA@EXAMPLE.AM' })).toEqual({ name: 'Anna', email: 'anna@example.am', phone: null });
  });
  it('preserves omitted class-transformer contact fields during partial edits', () => {
    const changes = Object.assign(new EnquiryContactDto(), { email: null });
    expect(mergeContact({ name: 'Anna', email: 'anna@example.am', phone: '+37499123456' }, changes)).toEqual({ name: 'Anna', email: null, phone: '+37499123456' });
  });
  it('requires a nonblank name and a channel after merging', () => {
    expect(() => mergeContact(null, { name: ' ', phone: '+37499123456' })).toThrow('contact.name');
    expect(() => mergeContact(null, { name: 'Anna' })).toThrow('contact');
    expect(() => mergeContact(null, { name: 'Anna', phone: '099123456' })).toThrow('contact.phone');
  });
  it.each([4, 481, 0, -1])('rejects consultation duration %s minutes', (duration) => {
    const startsAt = new Date('2026-10-26T10:00:00Z');
    expect(() => validateConsultation({ startsAt, endsAt: new Date(startsAt.getTime() + duration * 60000), timezone: 'Asia/Yerevan' })).toThrow('endsAt');
  });
});
