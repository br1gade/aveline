/**
 * The organization this tab works in, for an account with several (docs/API.md §6: "Store selection
 * per tab"). An id, not a credential: a selection never grants a role. In memory where the browser
 * refuses storage.
 */
const STORAGE_KEY = 'aveline-organization';

let inMemory: string | undefined;

function stored(act: (storage: Storage) => string | null | void): string | undefined {
  try {
    return typeof window === 'undefined' ? undefined : (act(window.sessionStorage) ?? undefined);
  } catch {
    return undefined;
  }
}

export const organizationChoice = {
  read(): string | undefined {
    return stored((storage) => storage.getItem(STORAGE_KEY)) ?? inMemory;
  },
  choose(organizationId: string): void {
    inMemory = organizationId;
    stored((storage) => storage.setItem(STORAGE_KEY, organizationId));
  },
  clear(): void {
    inMemory = undefined;
    stored((storage) => storage.removeItem(STORAGE_KEY));
  },
};

const ORGANIZATION_CODES: ReadonlySet<string> = new Set([
  'ORGANIZATION_SELECTION_REQUIRED',
  'ORGANIZATION_CONTEXT_MISMATCH',
]);

/**
 * A refusal that choosing an organization answers: none chosen, a mismatch, or a choice this
 * account no longer has. The last is told from "not a member" by this tab holding a choice at all.
 */
export function isOrganizationRefusal(code: string | undefined): boolean {
  if (!code) return false;
  if (code === 'ORGANIZATION_ACCESS_DENIED') return organizationChoice.read() !== undefined;
  return ORGANIZATION_CODES.has(code);
}
