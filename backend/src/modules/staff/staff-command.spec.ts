import { PrismaService } from '../../prisma/prisma.service';
import { runStaffCommand } from './staff-command';
import { StaffService } from './staff.service';

/**
 * The ops command is how the first admin is made, so it is the one path
 * with no admin behind it: it must say exactly what it did, and refuse
 * anything it does not understand rather than guess.
 */
describe('runStaffCommand', () => {
  const setUp = () => {
    const staff = {
      grant: jest.fn().mockResolvedValue({ userId: 'u1', email: 'ani@aveline.am', name: 'Ani', role: 'ADMIN' }),
      revoke: jest.fn().mockResolvedValue(undefined),
      list: jest.fn().mockResolvedValue({ items: [{ userId: 'u1', email: 'ani@aveline.am', name: 'Ani', role: 'ADMIN' }] }),
    };
    const findFirst = jest.fn().mockResolvedValue({ id: 'u1' });
    const run = (args: string[]) => runStaffCommand(args, staff as unknown as StaffService, { user: { findFirst } } as unknown as PrismaService);
    return { staff, findFirst, run };
  };

  it('grants a role to the normalized address, with no acting admin', async () => {
    const { staff, run } = setUp();

    await expect(run(['grant', ' Ani@Aveline.AM ', 'ADMIN'])).resolves.toBe('ani@aveline.am is now ADMIN');
    expect(staff.grant).toHaveBeenCalledWith('ani@aveline.am', 'ADMIN', null);
  });

  it('revokes by address', async () => {
    const { staff, run } = setUp();

    await expect(run(['revoke', ' Ani@Aveline.AM'])).resolves.toBe('ani@aveline.am is no longer staff');
    expect(staff.revoke).toHaveBeenCalledWith('u1', null);
  });

  it('refuses to revoke an address no account has, touching no one', async () => {
    const { staff, findFirst, run } = setUp();
    findFirst.mockResolvedValue(null);

    await expect(run(['revoke', 'nobody@aveline.am'])).rejects.toMatchObject({ code: 'STAFF_ACCOUNT_NOT_FOUND' });
    expect(staff.revoke).not.toHaveBeenCalled();
  });

  it('lists staff one per line', async () => {
    const { run } = setUp();

    await expect(run(['list'])).resolves.toBe('ADMIN\tani@aveline.am\tAni');
  });

  it.each([
    [[]],
    [['grant', 'ani@aveline.am']],
    [['grant', 'ani@aveline.am', 'NONE']],
    [['grant', 'ani@aveline.am', 'admin']],
    [['grant', '  ', 'ADMIN']],
    [['grant', 'ani@aveline.am', 'ADMIN', 'extra']],
    [['revoke']],
    [['revoke', 'ani@aveline.am', 'extra']],
    [['list', 'extra']],
    [['promote', 'ani@aveline.am', 'ADMIN']],
    [['toString']],
    [['__proto__']],
  ])('refuses %p with its usage, changing nothing', async (args) => {
    const { staff, run } = setUp();

    await expect(run(args)).rejects.toThrow('Usage:');
    expect(staff.grant).not.toHaveBeenCalled();
    expect(staff.revoke).not.toHaveBeenCalled();
    expect(staff.list).not.toHaveBeenCalled();
  });
});
