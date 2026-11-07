import { parseTicketLayoutCsv } from './venue-ticket-layout-csv';

const HEADER = 'section_key,section_name,mode,row,seat,capacity';

function read(...records: string[]) {
  return parseTicketLayoutCsv(Buffer.from([HEADER, ...records].join('\n')));
}

describe('venue ticket layout CSV', () => {
  it('keeps first occurrence order and reads quoted names and zones', async () => {
    await expect(read(
      'floor,Standing,UNNUMBERED,,,150',
      'balcony,"Balcony, west",NUMBERED,B,12,',
      'balcony,"Balcony, west",NUMBERED,A,1,',
      'balcony,"Balcony, west",NUMBERED,B,13,',
    )).resolves.toEqual([
      { key: 'floor', name: 'Standing', mode: 'UNNUMBERED', capacity: 150 },
      { key: 'balcony', name: 'Balcony, west', mode: 'NUMBERED', rows: [
        { label: 'B', seats: ['12', '13'] }, { label: 'A', seats: ['1'] },
      ] },
    ]);
  });

  it.each([
    ['balcony,West,NUMBERED,B,12,', 'balcony,West,NUMBERED,B,12,', 'seat labels within a row'],
    ['floor,Floor,UNNUMBERED,,,3', 'floor,Floor,UNNUMBERED,,,4', 'repeats an unnumbered section'],
    ['balcony,West,NUMBERED,B,12,', 'balcony,East,NUMBERED,B,13,', 'changes the mode or name'],
  ])('rejects conflicting records without producing a layout', async (first, second, message) => {
    await expect(read(first, second)).rejects.toThrow(message);
  });
});
