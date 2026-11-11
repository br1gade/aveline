import { render, renderHook, screen } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import type { ReactNode } from 'react';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import { createAppApi } from '@/api/client';

import { readEventAccess, readOrganizationAccess } from './api';
import { ChangeableWith, GrantedPermissions, Permitted, useCan } from './components/granted';

const ORIGIN = 'http://api.test';
const server = setupServer();
const api = createAppApi(ORIGIN, {});

beforeAll(() => server.listen({ onUnhandledFrame: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

function within(permissions: Parameters<typeof GrantedPermissions>[0]['permissions']) {
  return ({ children }: { children: ReactNode }) => (
    <GrantedPermissions permissions={permissions}>{children}</GrantedPermissions>
  );
}

describe('what the caller may see but not change (FR-6, design PD-193)', () => {
  function form(permissions: Parameters<typeof GrantedPermissions>[0]['permissions']) {
    render(
      <GrantedPermissions permissions={permissions}>
        <ChangeableWith to="invitation:design" readOnly="Yours to see, not to change.">
          <label>
            Title
            <input defaultValue="Anna & Davit" />
          </label>
          <button type="submit">Save</button>
        </ChangeableWith>
      </GrantedPermissions>,
    );
  }

  it('shows it with every control off, and says why, to a role without the permission', () => {
    form(['invitation:read']);
    expect(screen.getByText('Yours to see, not to change.')).toBeInTheDocument();
    expect(screen.getByLabelText('Title')).toHaveValue('Anna & Davit');
    expect(screen.getByLabelText('Title')).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
  });

  it('offers it as it is to a role with it', () => {
    form(['invitation:design']);
    expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled();
    expect(screen.queryByText('Yours to see, not to change.')).not.toBeInTheDocument();
  });

  it('offers it while nothing is known', () => {
    form(null);
    expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled();
  });
});

describe('what the caller may do (FR-6, design PD-190)', () => {
  it('allows everything while nothing is known, as before the read existed', () => {
    expect(renderHook(() => useCan('member:manage')).result.current).toBe(true);
    const wrapper = within(null);
    expect(renderHook(() => useCan('member:manage'), { wrapper }).result.current).toBe(true);
  });

  it('allows what the access read granted, and nothing else', () => {
    const wrapper = within(['event:read', 'guest:read']);
    expect(renderHook(() => useCan('guest:read'), { wrapper }).result.current).toBe(true);
    expect(renderHook(() => useCan('guest:write'), { wrapper }).result.current).toBe(false);
  });

  it('answers from the nearest read, not one above it', () => {
    const Outer = within(['member:manage']);
    const Inner = within(['event:read']);
    const wrapper = ({ children }: { children: ReactNode }) => (
      <Outer>
        <Inner>{children}</Inner>
      </Outer>
    );
    expect(renderHook(() => useCan('member:manage'), { wrapper }).result.current).toBe(false);
    expect(renderHook(() => useCan('event:read'), { wrapper }).result.current).toBe(true);
  });

  it('shows an action only to whom it is granted', () => {
    render(
      <GrantedPermissions permissions={['event:read']}>
        <Permitted to="guest:write">
          <button type="button">Add a guest</button>
        </Permitted>
        <Permitted to="event:read">
          <p>The event</p>
        </Permitted>
      </GrantedPermissions>,
    );
    expect(screen.queryByRole('button', { name: 'Add a guest' })).not.toBeInTheDocument();
    expect(screen.getByText('The event')).toBeInTheDocument();
  });
});

describe('reading access', () => {
  it('reads an event’s permissions, and nothing is known when it is refused or fails', async () => {
    server.use(
      http.get(`${ORIGIN}/api/v1/events/e1/access`, () =>
        HttpResponse.json({ eventId: 'e1', organizationId: 'o1', permissions: ['event:read'] }),
      ),
      http.get(`${ORIGIN}/api/v1/events/e2/access`, () =>
        HttpResponse.json({ statusCode: 403, message: 'Forbidden resource' }, { status: 403 }),
      ),
      http.get(`${ORIGIN}/api/v1/events/e3/access`, () =>
        HttpResponse.json({ statusCode: 500, message: 'Boom' }, { status: 500 }),
      ),
    );
    await expect(readEventAccess(api, 'e1')).resolves.toEqual(['event:read']);
    await expect(readEventAccess(api, 'e2')).resolves.toBeNull();
    await expect(readEventAccess(api, 'e3')).resolves.toBeNull();
  });

  it('reads the organization’s permissions', async () => {
    server.use(
      http.get(`${ORIGIN}/api/v1/organizations/current/access`, () =>
        HttpResponse.json({
          organizationId: 'o1',
          canCreateEvents: true,
          permissions: ['event:read', 'member:manage'],
        }),
      ),
    );
    await expect(readOrganizationAccess(api)).resolves.toEqual(['event:read', 'member:manage']);
  });
});
