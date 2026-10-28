import { expectData, type ApiClient } from '@/api/client';
import type { InvitationStatus } from '@/features/events';

import { readDelivery, readDesignStatus, readSendResult } from './read';
import type {
  DeliveryReport,
  DeliveryWire,
  DesignStatus,
  DesignStatusWire,
  LifecycleWire,
  SendOutcome,
  SendResultWire,
} from './types';

/**
 * The draft's status and what blocks publishing. `GET /design` is the editor's whole draft
 * (`invitation:read`, which every role holds); only those two fields are read.
 */
export async function getDesignStatus(api: ApiClient, slug: string): Promise<DesignStatus> {
  const design = await expectData<DesignStatusWire>(
    api.GET('/api/v1/invitations/{slug}/design', { params: { path: { slug } } }),
  );
  return readDesignStatus(design);
}

/** Publishing, closing and reopening need `invitation:publish`. There is no way back to draft. */
export async function publishInvitation(api: ApiClient, slug: string): Promise<InvitationStatus> {
  const moved = await expectData<LifecycleWire>(
    api.POST('/api/v1/invitations/{slug}/publish', { params: { path: { slug } } }),
  );
  return moved.status;
}

/** Stops new replies; the page stays readable to guests. */
export async function closeInvitation(api: ApiClient, slug: string): Promise<InvitationStatus> {
  const moved = await expectData<LifecycleWire>(
    api.POST('/api/v1/invitations/{slug}/close', { params: { path: { slug } } }),
  );
  return moved.status;
}

export async function reopenInvitation(api: ApiClient, slug: string): Promise<InvitationStatus> {
  const moved = await expectData<LifecycleWire>(
    api.POST('/api/v1/invitations/{slug}/reopen', { params: { path: { slug } } }),
  );
  return moved.status;
}

/**
 * Every household not yet invited, or only the households of `guestIds`. Safe to press twice: a
 * household already reached is counted in `alreadySent` and not sent another (docs/API.md §6).
 */
export async function sendInvitation(
  api: ApiClient,
  slug: string,
  guestIds?: readonly string[],
): Promise<SendOutcome> {
  const result = await expectData<SendResultWire>(
    api.POST('/api/v1/invitations/{slug}/send', {
      params: { path: { slug } },
      body: guestIds ? { guestIds: [...guestIds] } : {},
    }),
  );
  return readSendResult(result);
}

/** Needs `guest:read`; the addresses only with `guest:contact:read`. */
export async function getDelivery(api: ApiClient, slug: string): Promise<DeliveryReport> {
  const report = await expectData<DeliveryWire>(
    api.GET('/api/v1/invitations/{slug}/delivery', { params: { path: { slug } } }),
  );
  return readDelivery(report);
}
