---
name: cw-organization-domain
description: "The data, rules, events and screens cadenway-organization-service owns, taken from the mockup, the integration guide and the repositories document. Load it before naming, modeling or testing anything in this service."
---

# organization-service domain

## What this service owns

Organizations and who belongs to them.

**Data**: Organizations (name, address slug, logo, language), members and roles, invitations and invite link, guests, verified domains, security policies, the audit log (90 days).

**API**: Organizations, members, roles, invitations, domains, ownership transfer, deletion, audit log and CSV export.

**Events emitted**: `organization.created.v1`, `organization.updated.v1`, `member.joined.v1`, `member.role-changed.v1`, `member.removed.v1`, `invitation.issued.v1` (`asyncapi/organization-service.yaml`; none restricted). Later phases (deletion, verified domains) add their own versioned events once `cadenway-api-contracts` publishes them.

**Events consumed**: `user.signed-up.v1`, `user.email-verified.v1`, `user.profile-updated.v1`, `user.email-changed.v1` and `user.two-step-verification-changed.v1` of identity-service, into the user directory (names and addresses of the members, the verified address that accepts an invitation, whether each account has two-step verification, which only the owner and the admins see), and `user.deleted.v1`, which removes the memberships of a deleted account and keeps it in the directory as « Ancien membre ». Later phases add the seat count of billing-service and the audit log once their events exist in the contract.

**External systems**: DNS lookups for domain verification (TXT record).

**Mockup screens**: Organisations; Organisation › Général, Membres, Journal d’audit; the Share dialog.

## Rules this service guards

- Roles (decision 1 of P2b): `owner` (the creator, one per organization), `admin`, `member`, `guest`. The owner and the admins update the organization, invite, see the pending invitations, change roles and remove members; members read the member list; guests do not. Nobody changes the role of the owner or removes them, and nobody becomes owner by a change of role. This service decides it from its own members, never from the token.
- Guests take no seat: `memberCount` counts owner, admins and members. Inviting as a guest is explicit in P2b; making any address outside the verified domains (ateliernord.fr, lumen.coop in fixtures) a guest arrives with the verified domains, in a later phase.
- An invitation is valid 7 days; a resend starts them again; it is accepted only by the account whose verified address is the invited one (decision 5).
- An invitation email goes out at most once an hour (a resend sooner answers `429 invitation.resend-throttled`), and an organization causes at most 100 invitation emails in any 24 hours, issues, creation invitations and resends together (`429 invitation.daily-limit-reached`; a batch over what remains is refused as a whole). Decision 1 of the P2b security follow-ups.
- A resource of another organization answers 404, never 403 (decision 9). The address slug is unique across organizations (decision 10).
- Transferring ownership requires choosing a member (later phase).
- Deleting the organization requires typing its exact name.
- Audit entries are kept 90 days.

## Notes

Built in this repository from the start: it never lives as a module of another service.

Decided: the authentication policies (required MFA, session lifetime, allowed sign-in methods) and the SAML connections belong to cadenway-identity-service, which enforces them: the "security policies" of the data above are not stored here. For the Share dialog this service supplies the directory of members and guests; access grants on spaces and lists, access requests and favorites belong to cadenway-task-service. It keeps a user directory projected from `user.signed-up.v1`, `user.email-verified.v1`, `user.profile-updated.v1`, `user.email-changed.v1` and `user.two-step-verification-changed.v1` (only its `enabled`, P2c-2); on `user.deleted.v1` it removes the memberships of the account and forgets its name and address (P2c).

Everything above comes from the [repositories document](https://claude.ai/artifact/BPinmYxoF3mbK8w9BMB43N) and the
[integration guide](https://claude.ai/artifact/CpJHVCiFfF9j3KbHQ2S1Et). When the mockup and this skill disagree, the mockup wins and
this skill is corrected in the same change.
