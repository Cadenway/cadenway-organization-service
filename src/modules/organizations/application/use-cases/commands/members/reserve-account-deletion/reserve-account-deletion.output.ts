/** The attempt state committed by the Organization transaction. */
export type ReserveAccountDeletionOutput =
  | { readonly status: 'created' | 'reused' | 'not-found' | 'conflict' }
  | { readonly status: 'owner'; readonly organizationIds: readonly string[] };
