import { assertManagesOrganization } from '../../../../../domain/policies/members/member-permissions.policy.js';
import { toOrganizationRefusal } from '../../../../mappers/refusals/organization-refusal.mapper.js';
import { OrganizationRefusal } from '../../../../models/refusals/organization-refusal.model.js';
import type { AutomationRecipientReader } from '../../../../ports/outbound/persistence/automation/automation-recipient-reader.port.js';
import type { CheckAutomationRecipientInput } from './check-automation-recipient.input.js';
import type { CheckAutomationRecipientOutput } from './check-automation-recipient.output.js';

/** Checks a recipient after authorizing the caller against the same tenant snapshot. */
export class CheckAutomationRecipient {
  // #region Constructor
  /** Uses a reader that observes both active memberships together. */
  public constructor(private readonly memberships: AutomationRecipientReader) {}
  // #endregion

  // #region Methods
  /** Returns only current eligibility to an authorized owner or administrator. */
  public async execute(
    input: CheckAutomationRecipientInput,
  ): Promise<CheckAutomationRecipientOutput> {
    const snapshot = await this.memberships.read(
      input.organizationId,
      input.actorUserId,
      input.userId,
    );
    if (snapshot.actorRole === null) {
      throw new OrganizationRefusal({ reason: 'organization-not-found' });
    }
    try {
      assertManagesOrganization(snapshot.actorRole);
    } catch (error) {
      throw toOrganizationRefusal(error);
    }
    return { eligible: snapshot.eligible };
  }
  // #endregion
}
