import { createVisitorApi } from '@/api/visitor.server';

import { fetchReply, type ReplyLink } from './api';
import type { ReplyRecord } from './types';

/**
 * The saved reply and the household, read on the server beside the invitation. `null` when it
 * cannot be read: the page then says so rather than offering a form that might overwrite a
 * household's answers it never saw.
 */
export async function loadReply(link: ReplyLink, incoming: Request): Promise<ReplyRecord | null> {
  const api = createVisitorApi(incoming);
  try {
    return await fetchReply(api, link);
  } catch {
    return null;
  }
}
