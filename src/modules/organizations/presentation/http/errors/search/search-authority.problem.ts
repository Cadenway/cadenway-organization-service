import { ProblemException } from '@cadenway/nest-common';

import { answerRefusals } from '../organizations/organization-refusal.problem.js';

/** Reports an incomplete Search snapshot without exposing infrastructure details. */
export function unavailableSearchAuthority(): ProblemException {
  return new ProblemException({ status: 503, code: 'organization.unavailable' });
}

/** Preserves published refusals and conceals failures to complete the snapshot. */
export async function answerSearchAuthority<TResult>(
  read: () => Promise<TResult>,
): Promise<TResult> {
  try {
    return await answerRefusals(read);
  } catch (error) {
    if (error instanceof ProblemException) {
      throw error;
    }
    throw unavailableSearchAuthority();
  }
}
