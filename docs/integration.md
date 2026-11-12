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

Starts as a module of cadenway-identity-service; this repository receives it when the extraction is decided.

Everything above comes from the [repositories document](https://claude.ai/artifact/BPinmYxoF3mbK8w9BMB43N) and the
[integration guide](https://claude.ai/artifact/CpJHVCiFfF9j3KbHQ2S1Et). If the mockup disagrees with this guide, update the guide and its source skill for both assistants.

## Contract and delivery sequence

The `cadenway-api-contracts` repository owns HTTP and event specifications. Consumers use published `@cadenway/contracts` packages and `@cadenway/nest-messaging`; do not redefine payloads or connect to another service's database. Change contracts first, then the producing service, followed by gateways and listeners, and finally the webapp. Planned event names on this page must be checked against the actual published specification before use.

## References

[Interactive mockup](https://claude.ai/artifact/KYRM7AnsYLiBLBLKy8i4HE), [integration guide](https://claude.ai/artifact/CpJHVCiFfF9j3KbHQ2S1Et), and [repositories and packages](https://claude.ai/artifact/BPinmYxoF3mbK8w9BMB43N). Use [AGENTS.md](../AGENTS.md) as the local source for ownership and hard limits.
