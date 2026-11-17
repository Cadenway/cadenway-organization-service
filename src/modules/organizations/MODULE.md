# Organizations

## Purpose

Organizations and who belongs to them, for P2b of the plan:

- organizations: profile ("Profil de l'organisation": name, address slug, description, website,
  default language), the plan `free` until billing exists, the answers of the creation form and
  the owner;
- members: one membership per account and organization with its role (`owner`, `admin`, `member`,
  `guest`), kept after a removal with its last version;
- invitations: an address invited with a role, valid 7 days, resent, revoked, accepted or refused;
- the user directory: the name, the address and its verification of every account of
  identity-service, projected from its events, to show the members and match the invitations.

One module, four areas: the creation writes an organization, its owner and its invitations in one
transaction, an acceptance writes an invitation and a membership, and the member list sorts and
searches by the names of the directory in one query; separate modules could not join their
tables. It does not own the current organization of a session, the personal API tokens or the
copy of the memberships that introspection reads (identity-service), the scopes and the rate
limit (api-gateway), nor the invitation email (notification-service, from `invitation.issued.v1`).
Logo, seats, verified domains, auto-join, the reusable link, ownership transfer, deletion and the
audit log are later phases.

## Public entry points

| Entry point | Consumers |
| ----------- | --------- |
| None        | None      |

`organizations.module.ts` registers the four HTTP controllers, the three event handlers and the
providers of the module; no other module imports it.

## Owned tables

| Table             | Key                                                 | Organization scoping                                   |
| ----------------- | --------------------------------------------------- | ------------------------------------------------------ |
| `organizations`   | `id`, unique `slug`                                 | Policy on `id` (the organization itself), forced       |
| `members`         | `id`; one active per (`organization_id`, `user_id`) | `organization_id`, policy forced                       |
| `invitations`     | `id`; one pending per (`organization_id`, `email`)  | `organization_id`, policy forced                       |
| `directory_users` | `user_id`, the id identity-service gave the account | None: an account belongs to no organization, no policy |

Created by `migrations/0001_organizations_members_invitations.sql`, with the `FORCE ROW LEVEL
SECURITY` statements added by hand. One owner at most per organization (partial unique index).
`user_id` and `invited_by_user_id` name accounts of identity-service without a foreign key; the
foreign keys stay inside the module. `name_key` columns hold `searchKeyOf` of the names, the sort
and search key. The application role `organization_app` reads and writes the rows and runs no DDL.

## API

From `openapi/internal/organization-service.yaml` of the installed `@cadenway/contracts`; issuer
`api-gateway`, actor `user`. "Required" routes act on the organization of the internal token in its
tenant transaction; "none" routes ignore it.

| Route                                                      | Organization | Success                 | Refusals                                                                                                                                                  |
| ---------------------------------------------------------- | ------------ | ----------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `POST /internal/v1/organizations`                          | None         | 201, `Location`, `ETag` | 400, 404 `user.not-synchronized`, 409 `organization.slug-taken`, 422 `organization.slug-invalid`                                                          |
| `GET /internal/v1/organizations`                           | None         | 200                     | 400                                                                                                                                                       |
| `GET /internal/v1/organization`                            | Required     | 200, `ETag`             | 404 `organization.not-found`                                                                                                                              |
| `PATCH /internal/v1/organization`                          | Required     | 200, `ETag`             | 400, 403 `organization.role-forbidden`, 404, 409 `organization.slug-taken`, 412 `request.version-mismatch`                                                |
| `GET /internal/v1/members`                                 | Required     | 200                     | 400, 403 `organization.role-forbidden`, 404 `organization.not-found`                                                                                      |
| `GET /internal/v1/members/{memberId}`                      | Required     | 200, `ETag`             | 400, 403, 404 `member.not-found`                                                                                                                          |
| `PATCH /internal/v1/members/{memberId}`                    | Required     | 200, `ETag`             | 400, 403, 404, 412 `request.version-mismatch`, 422 `member.owner-protected`                                                                               |
| `DELETE /internal/v1/members/{memberId}`                   | Required     | 204                     | 400, 403, 404, 422 `member.owner-protected`                                                                                                               |
| `POST /internal/v1/invitations`                            | Required     | 200                     | 400, 403, 404 `organization.not-found`                                                                                                                    |
| `GET /internal/v1/invitations`                             | Required     | 200                     | 400, 403, 404                                                                                                                                             |
| `DELETE /internal/v1/invitations/{invitationId}`           | Required     | 204                     | 400, 403, 404 `invitation.not-found`, 409 `invitation.answered`                                                                                           |
| `POST /internal/v1/invitations/{invitationId}/resend`      | Required     | 200, `ETag`             | 400, 403, 404, 409 `invitation.revoked`, `invitation.answered`                                                                                            |
| `GET /internal/v1/users/{userId}/invitations`              | None         | 200                     | 400, 404 `user.not-found`                                                                                                                                 |
| `POST /internal/v1/users/{userId}/invitations/{id}/accept` | None         | 200                     | 400, 403 `invitation.email-mismatch`, 404 `invitation.not-found`, `user.not-found`, 409 `invitation.revoked`, `invitation.answered`, `invitation.expired` |
| `POST /internal/v1/users/{userId}/invitations/{id}/refuse` | None         | 204                     | As the acceptance                                                                                                                                         |

Every route also answers the 401 and 403 of the internal token guard. The titles are the English
reason phrases; the gateway answers the French titles of the public specs.

## Events emitted

All appended to the outbox in the transaction of the change, with the organization of the change
and the version of the aggregate after it; none is restricted.

| Event                     | When                                                             | Actor                    | Version           |
| ------------------------- | ---------------------------------------------------------------- | ------------------------ | ----------------- |
| `organization.created.v1` | An organization is created                                       | The creator, its owner   | 1                 |
| `organization.updated.v1` | A patch of the organization moves something (`changed`)          | The owner or the admin   | Organization's    |
| `member.joined.v1`        | The owner at the creation; an account that accepts an invitation | The account that joined  | 1                 |
| `member.role-changed.v1`  | A member gets another role                                       | The owner or the admin   | Membership's (2+) |
| `member.removed.v1`       | A member is removed, its last event                              | The owner or the admin   | Membership's (2+) |
| `invitation.issued.v1`    | An invitation is created (batch or creation form) or resent      | The sender, also inviter | Invitation's      |

Revoking and refusing emit nothing; a patch or a role change that moves nothing emits nothing.
The language of `invitation.issued.v1` is the default language of the organization. No rebuild
use case exists yet: identity-service, the one consumer of the membership events today, reads
the seven days the stream holds when it starts; a consumer that needs the memberships beyond them
(the permissions already allow `rebuild.*.member`) needs a rebuild item schema in
`@cadenway/contracts` and a re-emission use case here, with `RebuildEmitter`.

## Events consumed

| Event                     | Durable consumer                                     | Effect                         |
| ------------------------- | ---------------------------------------------------- | ------------------------------ |
| `user.signed-up.v1`       | `organization-service__project-user-signed-up`       | Name and address, not verified |
| `user.email-verified.v1`  | `organization-service__project-user-email-verified`  | Verified address               |
| `user.profile-updated.v1` | `organization-service__project-user-profile-updated` | Name                           |

- Each handler starts from what `EVENTS` still holds (`deliverPolicy: 'all'`): a new deployment
  learns the accounts of the last seven days before it started, not only the next ones.
- The deduplicator of `OutboxModule` records `(consumer, event id)` in `processed_events` in the
  system transaction of the delivery, with the effect: a redelivery is skipped. The three events
  travel on separate subjects and consumers, so `claimVersion` (per consumer) cannot order them:
  each part of an entry keeps the version of the account that set it (`name_version`,
  `email_version`) and an older event never overwrites a newer one, whatever the order of arrival.
- The entry is locked (`select … for update` after an `insert … on conflict do nothing`), so two
  events of one account apply one after the other.
- A dead letter of these consumers is replayed by an operator once its cause is fixed; applying an
  event twice changes nothing.

**Beyond the retention of the stream.** An account whose events left `EVENTS` (seven days) before
this service first consumed them, or a directory lost and recreated, is not recovered by the
stream. The kit's rebuild fits (identity-service would re-emit its accounts with `RebuildEmitter`
on `rebuild.organization.user`, which the `organization` user may subscribe to, and this module
would apply each item with `onRebuild`), but no rebuild item schema of the accounts exists in
`@cadenway/contracts` and identity-service has no rebuild use case: **open decision**, reported to
cadenway-api-contracts and identity-service. Until then, a directory entry missing for an old
account answers `404 user.not-synchronized` at the creation of an organization, and an empty list
of received invitations.

## Invariants

- Roles (decision 1 of P2b): the owner and the admins update the organization, invite, see and
  manage the pending invitations, change roles and remove members; members read the member list;
  guests do not (`403 organization.role-forbidden`). The owner is the creator and the only one;
  nobody changes their role or removes them (`422 member.owner-protected`) and nobody becomes owner
  (`role: owner` is refused by the contract schema). Decided from this module's members, never from
  the role or the scopes of the token.
- An actor that is not an active member of the organization of the token answers
  `404 organization.not-found`; a member, an invitation or an organization of another organization
  is invisible to the tenant transaction and answers 404, never 403 (decision 9).
- The address is derived from the name as the creation form does (accents removed, lowercase,
  other runs to `-`, dashes trimmed, cut to 63, a trailing dash of the cut dropped); fewer than 2
  characters answers 422; unique across organizations, decided by the unique index (decision 10).
- A name is trimmed, 1 to 120 characters; a description has 280 characters at most; a website is
  an absolute http or https URL without credentials nor unencoded quotes, spaces or angle brackets
  (any other scheme, such as `javascript:`, is refused with 400).
- `memberCount` counts owner, admins and members, never guests.
- An invitation is valid 7 days from its last sending; a resend starts them again and adds a
  version; an expired invitation stays pending until resent or revoked; revoking a revoked one
  changes nothing; an answered one is never revoked, resent or answered again.
- Inviting answers per distinct address (case-insensitive, in the order given): `already-member`
  for the verified address of an active member, `already-invited` with the pending invitation,
  `invited` otherwise; the verified address of the creator in the creation form is
  `already-member`.
- An invitation is accepted or refused only by the account whose verified address, in the
  directory, is the invited address (decision 5); the checks run in the order of the contract, and
  the address is checked again under the lock of the invitation.
- A cursor is unsigned: its id must be a UUID and its key the sort key of its list (an instant for
  the invitation lists), else `400 request.invalid`, the code of the contract.
- Every refusal answers a code the operation declares in `openapi/internal/organization-service.yaml`
  (`tests/organizations.int-spec.ts` checks each error response against it): the kit's
  `pagination.cursor-invalid` and `request.if-match-invalid` are answered as `request.invalid`, a
  stale `If-Match` as `412 request.version-mismatch` with `details.version`.
- The directory applies each part of an account by version; a directory entry is never deleted.
- Never logged by this module: an address, a name, a token.

## Transactions

`DrizzleOrganizationsUnitOfWork` runs each use case in one transaction of the kit's runners, the
acceptance and the refusal in two (a read-only check, then the write):

- Tenant transaction of the organization of the token: reading and patching the organization,
  every member and invitation route. The membership of the actor, the change, its version check
  and its event commit together.
- System transaction, the **bounded exceptions** of decision 9, each with explicit filters:
  - the creation of an organization: the organization does not exist before it and PostgreSQL
    assigns its id on insert, so no tenant transaction can hold it; it writes the rows of the new
    organization only (its owner, its invitations, its outbox rows, which the kit accepts in a
    system transaction) and reads the directory entry of the actor;
  - the list of the organizations of the actor: a read-only query filtered on `members.user_id`;
  - the invitations addressed to the actor: a read-only query filtered on the verified address
    of the actor's directory entry;
  - the first checks of an answer to an invitation: a read-only lookup of one invitation by id
    and of the actor's directory entry;
  - the projection of the directory: one entry by its account id, in the transaction of the
    deduplicator.
- Tenant transaction of the organization of an invitation (`runInOrganizationOf`, which takes the
  stored invitation, never an id): the acceptance and the refusal lock the invitation and check its
  address and state again there, as the contract requires; the acceptance writes the membership and
  `member.joined.v1` with it.

Any failure rolls back the business rows and the outbox rows together
(`tests/organizations.int-spec.ts` proves it on the creation).

## Decisions

- The decisions of P2b this module applies, from the plan of the phase (the user may revise them):
  1. Roles `owner`, `admin`, `member`, `guest`; one owner, the creator; the owner and the admins
     update the organization, invite, change roles and remove members; nobody changes the role of
     the owner or removes them, nobody becomes owner by a change of role; members read the member
     list, guests do not; pending invitations are visible to the owner and the admins only; this
     service decides it from its own data, the gateway never decides a role rule.
  2. This service owns organizations, members and invitations and emits the membership events,
     from which identity-service keeps its copy within seconds (decision 3 of the plan).
  3. A user directory projected from `user.signed-up.v1`, `user.email-verified.v1` and
     `user.profile-updated.v1` shows the names and addresses of the members (decision 4).
  4. Invitations last 7 days; a resend restarts them; acceptance requires the session whose
     verified address is the invited one, so the invitation id is not a capability and its event
     travels on `evt.`; an address already member or already invited is answered per address; the
     creation form may invite addresses as `member` in the same transaction (decision 5).
  5. A resource of another organization answers 404, never 403; the reads across organizations
     (my organizations, the invitations addressed to me, the directory) run in the system runner
     with an explicit user filter, the bounded exceptions of Transactions (decision 9).
  6. The address is derived from the name as the mockup does and unique across organizations; a
     taken one answers 409 (decision 10).
- The creation appends its events in its system transaction, while
  `asyncapi/organization-service.yaml` says every event is appended "in the tenant transaction of
  that organization" (the kit accepts either). Nothing differs for a consumer; reported to
  cadenway-api-contracts to state the exception.
- One module, not four: see Purpose.
- `organizations` carries its policy on `id` with the predicate of the kit, since its row is the
  organization; the other tenant tables use `organizationPolicy()`.
- The acceptance and the refusal run in the tenant transaction of the invitation's organization
  with `runWithOrganizationContext`, built from the organization of the stored invitation and the
  verified actor, never from a value of the request. The kit reserves that function for entry
  points other than HTTP; the contract requires the tenant transaction here, and a system write
  would drop row-level security, so this module takes the stricter of the two. Reported to
  cadenway-service-kit.
- An account that accepts an invitation of an organization it already belongs to keeps its
  membership: the invitation is accepted, no membership or event is added. The contract names no
  refusal for it, and the batch already answers `already-member`.
- A resend names the one who resends as the sender of the email (`actor` and `inviter` of
  `invitation.issued.v1`); `invitedBy` of the list stays the first sender.
- A new organization's default language is `fr`: the creation form asks none, and the example of
  the contract answers it.
- The outcome lists return the addresses trimmed and lowercased, the form every comparison uses.
- A member whose directory entry lacks a name, never expected, shows its address as its name; the
  sender of an invitation likewise, cut to the 120 characters of `inviter.name`.
- The kit's `pagination.cursor-invalid` is answered as `400 request.invalid`, the code the contract
  declares; reported to cadenway-api-contracts and cadenway-service-kit.
- A malformed `If-Match` answers `400 request.invalid` (the kit's parser, mapped to the code of the
  contract).
- `tests/organizations.int-spec.ts` proves every route, the isolation, the role rules, the
  invitation lifecycle, the events in the stream, the directory projection from events published
  before the service started and their redelivery, and the rollback, on real PostgreSQL and NATS.
