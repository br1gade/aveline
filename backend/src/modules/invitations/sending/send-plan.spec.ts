import {
  SendableGuest,
  SendableHousehold,
  displayName,
  planInvitationSend,
} from './send-plan';

const guest = (overrides: Partial<SendableGuest> = {}): SendableGuest => ({
  id: `g-${Math.random().toString(36).slice(2, 8)}`,
  firstName: 'Armen',
  lastName: 'Petrosyan',
  email: 'armen@test.local',
  isPrimary: false,
  locale: 'hy',
  token: 'tok',
  anonymizedAt: null,
  ...overrides,
});

const household = (guests: SendableGuest[], name = 'Petrosyan family'): SendableHousehold => ({
  id: `h-${name}`,
  name,
  guests,
});

describe('planInvitationSend', () => {
  /**
   * The rule the household model exists for. Three emails about one
   * invitation means three people answering for the same seats.
   */
  it('sends one invitation per household, not one per guest', () => {
    const plan = planInvitationSend([
      household([
        guest({ isPrimary: true, email: 'armen@test.local' }),
        guest({ email: 'lusine@test.local' }),
        guest({ email: 'narek@test.local' }),
      ]),
    ]);

    expect(plan.recipients).toHaveLength(1);
    expect(plan.recipients[0].guest.email).toBe('armen@test.local');
  });

  it('prefers the primary guest', () => {
    const plan = planInvitationSend([
      household([
        guest({ email: 'lusine@test.local' }),
        guest({ isPrimary: true, email: 'armen@test.local' }),
      ]),
    ]);

    expect(plan.recipients[0].guest.email).toBe('armen@test.local');
  });

  /**
   * An address that exists beats a role that does not: a couple where only
   * one of them gave an email should still be invited.
   */
  it('falls back to whoever has an address when the primary has none', () => {
    const plan = planInvitationSend([
      household([
        guest({ isPrimary: true, email: null }),
        guest({ email: 'lusine@test.local' }),
      ]),
    ]);

    expect(plan.recipients).toHaveLength(1);
    expect(plan.recipients[0].guest.email).toBe('lusine@test.local');
  });

  it('carries the chosen guest’s own token, so the link personalises', () => {
    const plan = planInvitationSend([
      household([guest({ isPrimary: true, email: null }), guest({ token: 'lusine-token' })]),
    ]);

    expect(plan.recipients[0].guest.token).toBe('lusine-token');
  });

  it('plans every household independently', () => {
    const plan = planInvitationSend([
      household([guest({ isPrimary: true })], 'Petrosyan'),
      household([guest({ isPrimary: true, email: null })], 'Sargsyan'),
      household([guest({ isPrimary: true })], 'Hakobyan'),
    ]);

    expect(plan.recipients).toHaveLength(2);
    expect(plan.skipped.map((entry) => entry.householdName)).toEqual(['Sargsyan']);
  });

  describe('who cannot be reached', () => {
    it('reports a household with no addresses at all', () => {
      const plan = planInvitationSend([household([guest({ email: null })])]);

      expect(plan.recipients).toHaveLength(0);
      expect(plan.skipped[0].reason).toContain('No email address');
    });

    it('reports an empty household', () => {
      const plan = planInvitationSend([household([])]);

      expect(plan.skipped[0].reason).toContain('no guests');
    });

    /**
     * Erasure removed the address and rotated the token, so writing to them
     * would be both impossible and a breach of the request they made.
     */
    it('never writes to a guest who asked to be erased', () => {
      const plan = planInvitationSend([
        household([guest({ email: null, anonymizedAt: new Date('2026-10-01') })]),
      ]);

      expect(plan.recipients).toHaveLength(0);
      expect(plan.skipped[0].reason).toContain('removed');
    });

    it('skips an erased guest but still invites their household', () => {
      const plan = planInvitationSend([
        household([
          guest({ isPrimary: true, email: null, anonymizedAt: new Date('2026-10-01') }),
          guest({ email: 'lusine@test.local' }),
        ]),
      ]);

      expect(plan.recipients[0].guest.email).toBe('lusine@test.local');
    });

    // A typo quoted back is fixable; "no email address" when one is present
    // sends the host looking in the wrong place.
    it.each(['not-an-address', 'two words@test.local', '@', ''])(
      'quotes %s back rather than calling it missing',
      (email) => {
        const plan = planInvitationSend([household([guest({ email })])]);

        expect(plan.recipients).toHaveLength(0);
        expect(plan.skipped[0].reason).toContain('does not look like');
      },
    );

    it.each([
      { label: 'surrounding spaces', email: '  armen@test.local  ' },
      { label: 'mixed case', email: 'Armen@Test.Local' },
    ])('accepts an address with $label', ({ email }) => {
      expect(planInvitationSend([household([guest({ email })])]).recipients).toHaveLength(1);
    });
  });

  it('plans nothing for no households', () => {
    expect(planInvitationSend([])).toEqual({ recipients: [], skipped: [] });
  });
});

describe('displayName', () => {
  it('joins the names a guest actually has', () => {
    expect(displayName(guest({ firstName: 'Armen', lastName: 'Petrosyan' }))).toBe(
      'Armen Petrosyan',
    );
    expect(displayName(guest({ firstName: 'Armen', lastName: null }))).toBe('Armen');
  });
});
