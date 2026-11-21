import { Module } from '@nestjs/common';

import { subscriptionChangedHandlerProvider } from './composition/providers/adapters/billing/subscription-changed-handler.provider.js';
import { expireOrganizationLogoUploadsHandlerProvider } from './composition/providers/adapters/logo/expire-organization-logo-uploads-handler.provider.js';
import { clockProvider } from './composition/providers/adapters/organizations/clock.provider.js';
import { unitOfWorkProvider } from './composition/providers/adapters/organizations/unit-of-work.provider.js';
import { applySeatEntitlementProvider } from './composition/providers/use-cases/billing/apply-seat-entitlement.provider.js';
import { billingAuthorityProviders } from './composition/providers/use-cases/billing/billing-authority.provider.js';
import { checkAutomationRecipientProvider } from './composition/providers/use-cases/automation/check-automation-recipient.provider.js';
import { projectEmailChangeProvider } from './composition/providers/use-cases/directory/project-email-change.provider.js';
import { projectEmailVerificationProvider } from './composition/providers/use-cases/directory/project-email-verification.provider.js';
import { projectProfileUpdateProvider } from './composition/providers/use-cases/directory/project-profile-update.provider.js';
import { projectTwoStepVerificationChangeProvider } from './composition/providers/use-cases/directory/project-two-step-verification-change.provider.js';
import { projectUserSignUpProvider } from './composition/providers/use-cases/directory/project-user-sign-up.provider.js';
import { acceptInvitationProvider } from './composition/providers/use-cases/invitations/accept-invitation.provider.js';
import { inviteMembersProvider } from './composition/providers/use-cases/invitations/invite-members.provider.js';
import { listInvitationsProvider } from './composition/providers/use-cases/invitations/list-invitations.provider.js';
import { listReceivedInvitationsProvider } from './composition/providers/use-cases/invitations/list-received-invitations.provider.js';
import { refuseInvitationProvider } from './composition/providers/use-cases/invitations/refuse-invitation.provider.js';
import { resendInvitationProvider } from './composition/providers/use-cases/invitations/resend-invitation.provider.js';
import { revokeInvitationProvider } from './composition/providers/use-cases/invitations/revoke-invitation.provider.js';
import { organizationLogoProviders } from './composition/providers/use-cases/logo/organization-logo.provider.js';
import { changeMemberRoleProvider } from './composition/providers/use-cases/members/change-member-role.provider.js';
import { getMemberProvider } from './composition/providers/use-cases/members/get-member.provider.js';
import { listMembersProvider } from './composition/providers/use-cases/members/list-members.provider.js';
import { lookupMemberNamesProvider } from './composition/providers/use-cases/members/lookup-member-names.provider.js';
import { removeDeletedUserProvider } from './composition/providers/use-cases/members/remove-deleted-user.provider.js';
import { removeMemberProvider } from './composition/providers/use-cases/members/remove-member.provider.js';
import { createOrganizationProvider } from './composition/providers/use-cases/organizations/create-organization.provider.js';
import { getCurrentOrganizationProvider } from './composition/providers/use-cases/organizations/get-current-organization.provider.js';
import { listMyOrganizationsProvider } from './composition/providers/use-cases/organizations/list-my-organizations.provider.js';
import { updateOrganizationProvider } from './composition/providers/use-cases/organizations/update-organization.provider.js';
import { getSearchMembershipProvider } from './composition/providers/use-cases/search/get-search-membership.provider.js';
import { listSearchOrganizationsProvider } from './composition/providers/use-cases/search/list-search-organizations.provider.js';
import { searchOrganizationCursorProvider } from './composition/providers/use-cases/search/search-organization-cursor.provider.js';
import { BillingAuthorityController } from './presentation/http/controllers/billing/billing-authority.controller.js';
import { AutomationRecipientController } from './presentation/http/controllers/automation/automation-recipient.controller.js';
import { QuotaNotificationRecipientsController } from './presentation/http/controllers/billing/quota-notification-recipients.controller.js';
import { InvitationsController } from './presentation/http/controllers/invitations/invitations.controller.js';
import { ReceivedInvitationsController } from './presentation/http/controllers/invitations/received-invitations.controller.js';
import { OrganizationLogoController } from './presentation/http/controllers/logo/organization-logo.controller.js';
import { MembersController } from './presentation/http/controllers/members/members.controller.js';
import { MemberNamesController } from './presentation/http/controllers/members/member-names.controller.js';
import { OrganizationsController } from './presentation/http/controllers/organizations/organizations.controller.js';
import { SearchAuthorityController } from './presentation/http/controllers/search/search-authority.controller.js';
import { UserDeletedHandler } from './presentation/messaging/handlers/users/user-deleted.handler.js';
import { UserEmailChangedHandler } from './presentation/messaging/handlers/users/user-email-changed.handler.js';
import { UserEmailVerifiedHandler } from './presentation/messaging/handlers/users/user-email-verified.handler.js';
import { UserProfileUpdatedHandler } from './presentation/messaging/handlers/users/user-profile-updated.handler.js';
import { UserSignedUpHandler } from './presentation/messaging/handlers/users/user-signed-up.handler.js';
import { UserTwoStepVerificationChangedHandler } from './presentation/messaging/handlers/users/user-two-step-verification-changed.handler.js';

/**
 * Class OrganizationsModule
 *
 * @description
 * Composition root of the organizations module: organizations, their members, the invitations to
 * join them, and the user directory projected from the events of identity-service (see its
 * `MODULE.md`). Use cases are plain classes built by the registered factories from their ports;
 * the transactions are the runners and the outbox of the kit, provided globally by `AppModule`.
 */
@Module({
  controllers: [
    OrganizationsController,
    OrganizationLogoController,
    MembersController,
    MemberNamesController,
    InvitationsController,
    ReceivedInvitationsController,
    SearchAuthorityController,
    AutomationRecipientController,
    BillingAuthorityController,
    QuotaNotificationRecipientsController,
  ],
  providers: [
    unitOfWorkProvider,
    clockProvider,
    ...organizationLogoProviders,
    ...billingAuthorityProviders,
    applySeatEntitlementProvider,
    checkAutomationRecipientProvider,
    expireOrganizationLogoUploadsHandlerProvider,
    createOrganizationProvider,
    updateOrganizationProvider,
    getCurrentOrganizationProvider,
    listMyOrganizationsProvider,
    getSearchMembershipProvider,
    listSearchOrganizationsProvider,
    searchOrganizationCursorProvider,
    listMembersProvider,
    lookupMemberNamesProvider,
    getMemberProvider,
    changeMemberRoleProvider,
    removeMemberProvider,
    inviteMembersProvider,
    listInvitationsProvider,
    resendInvitationProvider,
    revokeInvitationProvider,
    listReceivedInvitationsProvider,
    acceptInvitationProvider,
    refuseInvitationProvider,
    projectUserSignUpProvider,
    projectEmailVerificationProvider,
    projectProfileUpdateProvider,
    projectEmailChangeProvider,
    projectTwoStepVerificationChangeProvider,
    removeDeletedUserProvider,
    subscriptionChangedHandlerProvider,
    UserSignedUpHandler,
    UserEmailVerifiedHandler,
    UserProfileUpdatedHandler,
    UserEmailChangedHandler,
    UserTwoStepVerificationChangedHandler,
    UserDeletedHandler,
  ],
})
export class OrganizationsModule {}
