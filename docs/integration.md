# Domain and integration

[Documentation index](README.md) · [Repository instructions](../AGENTS.md)

**Status:** This page records the target design from repository instructions and skills. Its behavior has not been verified as implemented in this snapshot.

The tables and rules on this page are **target domain behavior**, not proof of a running service or an approved API. Source: `cw-organization-domain` ([Claude](../.claude/skills/cw-organization-domain/SKILL.md), [Codex](../.codex/skills/cw-organization-domain/SKILL.md)). The linked mockup and guides remain the source for product details; confirm ambiguous values before implementation.

## What this service owns

Organizations and who belongs to them.

**Data**: Organizations (name, address slug, logo, language), members and roles, invitations and invite link, guests, verified domains, security policies, the audit log (90 days).

**API**: Organizations, members, roles, invitations, domains, ownership transfer, deletion, audit log and CSV export.

**Events emitted**: `organization.created`, `organization.deleted`, `member.invited`, `member.joined`, `member.role-changed`, `member.removed`, `domain.verified`.

**Events consumed**: events relevant to the audit log, `subscription.changed` (updates seat count).

**External systems**: DNS lookups for domain verification (TXT record).

**Mockup screens**: Organisations; Organisation › Général, Membres, Journal d’audit; the Share dialog.

## Rules this service guards

- Any address outside the verified domains (ateliernord.fr, lumen.coop in fixtures) is a guest; guests take no seat.
- The owner role cannot be removed; transferring ownership requires choosing a member.
- Deleting the organization requires typing its exact name.
- Audit entries are kept 90 days.

## Notes

Built in this repository from the start: it never lives as a module of another service.

Decided: the authentication policies (required MFA, session lifetime, allowed sign-in methods) and the SAML connections belong to cadenway-identity-service, which enforces them: the "security policies" of the data above are not stored here. For the Share dialog this service supplies the directory of members and guests; access grants on spaces and lists, access requests and favorites belong to cadenway-task-service. It keeps a projection of user profiles from `user.profile-updated` and `user.deleted`.

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
