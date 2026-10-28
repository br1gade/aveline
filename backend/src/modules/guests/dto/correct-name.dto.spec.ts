import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CorrectNameDto } from './correct-name.dto';

describe('Personal name storage boundary', () => {
  it.each(['firstName', 'lastName'])('rejects a null byte in %s before Postgres', async (field) => {
    const input = plainToInstance(CorrectNameDto, { [field]: `Ani${String.fromCharCode(0)}Dupont` });
    const errors = await validate(input);
    expect(errors.map((error) => error.property)).toContain(field);
  });
});
