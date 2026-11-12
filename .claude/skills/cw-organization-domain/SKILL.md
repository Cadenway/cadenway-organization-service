---
name: cw-organization-domain
description: "The data, rules, events and screens cadenway-organization-service owns, taken from the mockup, the integration guide and the repositories document. Load it before naming, modeling or testing anything in this service."
---

# organization-service domain

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
[integration guide](https://claude.ai/artifact/CpJHVCiFfF9j3KbHQ2S1Et). When the mockup and this skill disagree, the mockup wins and
this skill is corrected in the same change.
