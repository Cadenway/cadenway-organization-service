/**
 * Type Plan
 *
 * @description
 * Plan of an organization: `free` ("Gratuit"), `team` ("Équipe") or `enterprise` ("Entreprise").
 * Read-only and always `free` until billing exists (P5 of the plan).
 *
 * @type {'free' | 'team' | 'enterprise'}
 */
export type Plan = 'free' | 'team' | 'enterprise';

/**
 * Constant INITIAL_PLAN
 *
 * @description
 * Plan of every organization at its creation ("Plan Gratuit au départ").
 *
 * @type {Plan}
 */
export const INITIAL_PLAN: Plan = 'free';
