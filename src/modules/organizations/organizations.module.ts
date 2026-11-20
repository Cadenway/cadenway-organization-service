import { Module } from '@nestjs/common';

import { clockProvider } from './composition/providers/adapters/organizations/clock.provider.js';
import { unitOfWorkProvider } from './composition/providers/adapters/organizations/unit-of-work.provider.js';
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
import { InvitationsController } from './presentation/http/controllers/invitations/invitations.controller.js';
import { ReceivedInvitationsController } from './presentation/http/controllers/invitations/received-invitations.controller.js';
import { MembersController } from './presentation/http/controllers/members/members.controller.js';
import { MemberNamesController } from './presentation/http/controllers/members/member-names.controller.js';
import { OrganizationsController } from './presentation/http/controllers/organizations/organizations.controller.js';
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
    MembersController,
    MemberNamesController,
    InvitationsController,
    ReceivedInvitationsController,
  ],
  providers: [
    unitOfWorkProvider,
    clockProvider,
    createOrganizationProvider,
    updateOrganizationProvider,
    getCurrentOrganizationProvider,
    listMyOrganizationsProvider,
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
    UserSignedUpHandler,
    UserEmailVerifiedHandler,
    UserProfileUpdatedHandler,
    UserEmailChangedHandler,
    UserTwoStepVerificationChangedHandler,
    UserDeletedHandler,
  ],
})
export class OrganizationsModule {}
