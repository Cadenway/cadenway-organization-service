import { ProblemException } from '@cadenway/nest-common';

import { OrganizationLogoRefusal } from '../../../../application/models/logo/organization-logo-refusal.model.js';
import { answerRefusals } from '../organizations/organization-refusal.problem.js';

/** Maps the logo domain's refusals to the operation's published problem codes. */
export async function answerLogoRefusals<TResult>(work: () => Promise<TResult>): Promise<TResult> {
  try {
    return await answerRefusals(work);
  } catch (error) {
    if (!(error instanceof OrganizationLogoRefusal)) throw error;
    switch (error.reason) {
      case 'file-too-large':
        throw new ProblemException({ status: 422, code: 'media.file-too-large' });
      case 'unsupported-type':
        throw new ProblemException({ status: 422, code: 'media.unsupported-type' });
      case 'idempotency-key-reused':
        throw new ProblemException({ status: 422, code: 'idempotency.key-reused' });
      case 'not-found':
        throw new ProblemException({ status: 404, code: 'media.not-found' });
      case 'upload-expired':
        throw new ProblemException({ status: 409, code: 'media.upload-expired' });
      case 'upload-superseded':
        throw new ProblemException({ status: 409, code: 'media.upload-superseded' });
      case 'upload-not-ready':
        throw new ProblemException({ status: 409, code: 'media.upload-not-ready' });
      case 'invalid-declaration':
        throw new ProblemException({ status: 400, code: 'request.invalid' });
    }
  }
}
