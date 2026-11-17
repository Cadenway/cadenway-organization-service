# Domain and integration

[Documentation index](README.md) · [Repository instructions](../AGENTS.md)

**Status:** This page records the target design from repository instructions and skills. Its behavior has not been verified as implemented in this snapshot.

The tables and rules on this page are **target domain behavior**, not proof of a running service or an approved API. Source: `cw-organization-domain` ([Claude](../.claude/skills/cw-organization-domain/SKILL.md), [Codex](../.codex/skills/cw-organization-domain/SKILL.md)). The linked mockup and guides remain the source for product details; confirm ambiguous values before implementation.

## What this service owns

Organizations and who belongs to them.

**Data**: Organizations (name, address slug, logo, language), members and roles, invitations and invite link, guests, verified domains, security policies, the audit log (90 days).

**API**: Organizations, members, roles, invitations, domains, ownership transfer, deletion, audit log and CSV export.

**Events emitted**: `organization.created.v1`, `organization.updated.v1`, `member.joined.v1`, `member.role-changed.v1`, `member.removed.v1`, `invitation.issued.v1` (`asyncapi/organization-service.yaml`; none restricted). Later phases (deletion, verified domains) add their own versioned events once `cadenway-api-contracts` publishes them.

**Events consumed**: `user.signed-up.v1`, `user.email-verified.v1` and `user.profile-updated.v1` of identity-service, into the user directory (names and addresses of the members, the verified address that accepts an invitation). Later phases add the seat count of billing-service and the audit log once their events exist in the contract.

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

Decided: the authentication policies (required MFA, session lifetime, allowed sign-in methods) and the SAML connections belong to cadenway-identity-service, which enforces them: the "security policies" of the data above are not stored here. For the Share dialog this service supplies the directory of members and guests; access grants on spaces and lists, access requests and favorites belong to cadenway-task-service. It keeps a user directory projected from `user.signed-up.v1`, `user.email-verified.v1` and `user.profile-updated.v1`; the contract has no account deletion event yet (P2c).

Everything above comes from the [repositories document](https://claude.ai/artifact/BPinmYxoF3mbK8w9BMB43N) and the
[integration guide](https://claude.ai/artifact/CpJHVCiFfF9j3KbHQ2S1Et). If the mockup disagrees with this guide, update the guide and its source skill for both assistants.

## Engineering standards

These skills fix the engineering standards this service follows. They are target conventions, not proof of an implementation in this snapshot.

| Skill                                                                                                                                                | What it fixes                                                                                                                                                                                                                           |
| ---------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `cw-database-conventions` ([Claude](../.claude/skills/cw-database-conventions/SKILL.md), [Codex](../.codex/skills/cw-database-conventions/SKILL.md)) | Plural snake_case tables, `id` from `uuidv7()`, `organization_id` first in tenant indexes, `version`, `timestamptz` dates, `text` with `CHECK` for enumerations, forced row-level security, a pool of 5 connections, timeouts per role. |
| `cw-logging-and-tracing` ([Claude](../.claude/skills/cw-logging-and-tracing/SKILL.md), [Codex](../.codex/skills/cw-logging-and-tracing/SKILL.md))    | JSON logs with fixed fields and masking, W3C `traceparent` over HTTP and NATS, the ESM start-up flags, metrics per route and lag alerts, health and shutdown semantics.                                                                 |
| `cw-jobs` ([Claude](../.claude/skills/cw-jobs/SKILL.md), [Codex](../.codex/skills/cw-jobs/SKILL.md))                                                 | Durable jobs on pg-boss through `@cadenway/nest-jobs`: enqueued in the use case transaction, one key per occurrence, bounded retries, a dead-letter queue.                                                                              |

## Contract and delivery sequence

The `cadenway-api-contracts` repository owns HTTP and event specifications. Consumers use published `@cadenway/contracts` packages and `@cadenway/nest-messaging`; do not redefine payloads or connect to another service's database. Change contracts first, then the producing service, followed by gateways and listeners, and finally the webapp. Planned event names on this page must be checked against the actual published specification before use.

## References

[Interactive mockup](https://claude.ai/artifact/KYRM7AnsYLiBLBLKy8i4HE), [integration guide](https://claude.ai/artifact/CpJHVCiFfF9j3KbHQ2S1Et), and [repositories and packages](https://claude.ai/artifact/BPinmYxoF3mbK8w9BMB43N). Use [AGENTS.md](../AGENTS.md) as the local source for ownership and hard limits.
