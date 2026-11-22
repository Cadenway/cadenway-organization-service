# Organizations

## Purpose

Organizations and who belongs to them, for P2b of the plan and the account changes of P2c and
P2c-2:

- organizations: profile ("Profil de l'organisation": name, address slug, description, website,
  default language and logo), the plan `free` until billing exists, the answers of the creation form
  and the owner;
- members: one membership per account and organization with its role (`owner`, `admin`, `member`,
  `guest`), kept after a removal with its last version;
- invitations: an address invited with a role, valid 7 days, resent at most once an hour, revoked,
  accepted or refused, and the ledger of the invitation emails that holds each organization to 100
  of them in any 24 hours;
- the user directory: the name, the address and its verification, and whether two-step
  verification is on, of every account of identity-service, projected from its events, to show the
  members ("Deux étapes" for the owner and the admins) and match the invitations; a deleted account
  loses its memberships and stays in the directory as a former member, without name, address or
  two-step verification.

One module, four areas: the creation writes an organization, its owner and its invitations in one
transaction, an acceptance writes an invitation and a membership, and the member list sorts and
searches by the names of the directory in one query; separate modules could not join their
tables. It does not own the current organization of a session, the personal API tokens or the
copy of the memberships that introspection reads (identity-service), the scopes and the rate
limit (api-gateway), nor the invitation email (notification-service, from `invitation.issued.v1`).
Seats, verified domains, auto-join, the reusable link, ownership transfer, deletion and the
audit log are later phases.

## Public entry points

| Entry point | Consumers |
| ----------- | --------- |
| None        | None      |

`organizations.module.ts` registers the HTTP controllers, the six event handlers and the
providers of the module; no other module imports it.

## Owned tables

| Table                            | Key                                                                              | Organization scoping                                   |
| -------------------------------- | -------------------------------------------------------------------------------- | ------------------------------------------------------ |
| `organizations`                  | `id`, unique `slug`                                                              | Policy on `id` (the organization itself), forced       |
| `members`                        | `id`; one active per (`organization_id`, `user_id`)                              | `organization_id`, policy forced                       |
| `invitations`                    | `id`; one pending per (`organization_id`, `email`)                               | `organization_id`, policy forced                       |
| `organization_logo_reservations` | (`organization_id`, `upload_id`), replay key scoped to organization and uploader | `organization_id`, policy forced                       |
| `invitation_emails`              | `id`; one row per invitation email sent                                          | `organization_id`, policy forced                       |
| `directory_users`                | `user_id`, the id identity-service gave the account                              | None: an account belongs to no organization, no policy |

Created by `migrations/0001_organizations_members_invitations.sql` and
`migrations/0002_invitation_emails.sql`, with the `FORCE ROW LEVEL SECURITY` statements added by
hand; `migrations/0003_directory_former_members.sql` adds `directory_users.deleted` (default
`false`) and the check that a deleted entry keeps no name, search key nor address;
`migrations/0004_directory_two_step_verification.sql` adds
`directory_users.two_step_verification_enabled` (default `false`) and
`two_step_verification_version` (default `0`, checked not negative). No check ties the flag to
`deleted`: a replica of the previous release deletes an account without knowing the column, and
must not fail on it. One owner at most per organization (partial unique index). `user_id` and
`invited_by_user_id` name accounts of identity-service without a foreign key; the foreign keys
stay inside the module. `name_key` columns hold `searchKeyOf` of the names, the sort and search
key. The application role `organization_app` reads and writes the rows and runs no DDL.

`invitation_emails` is the ledger of the daily allowance of invitation emails: one row per issue
(batch or creation) and per resend, with the organization, the invitation and the instant, never
the address. A resend overwrites `invitations.sent_at`, so that column cannot count the emails. A
row is written once and never changed, so it has no `version` nor `updated_at`. Each batch or
resend of an organization deletes its rows sent 24 hours ago or more, under the lock of the check:
the table holds 100 rows at most per organization, and no job purges it, so an organization that
stops inviting keeps its last rows. Their foreign keys are `no action`: the deletion of an
organization or of an invitation, a later phase, deletes its ledger rows first.

`0005_organization_logo` adds the nullable opaque `organizations.logo_id`, an independent
`logo_generation` and tenant-owned upload reservations. A reservation binds the uploader,
declaration and generation for up to five minutes. Its optional 24-hour replay record holds a
digest of the key. Storage owns the bytes and signed transfers.

`0006_billing_membership_index` adds `(organization_id, id)` for a bounded snapshot that includes
removed memberships. The Billing reader returns member IDs and source versions with the role of
active memberships. The Notification reader returns current owner and administrator user IDs
from the existing active-member index. Their HTTP adapters use the published service contracts.

## API

From `openapi/internal/organization-service.yaml` of the installed `@cadenway/contracts`; issuer
`api-gateway`, actor `user`. "Required" routes act on the organization of the internal token in its
tenant transaction; "none" routes ignore it.

Search uses two private, uncacheable routes. `GET /internal/v1/search-organizations` requires
the Search system identity without an organization claim and exports only organization IDs.
It resumes within the authenticated upper bound of the first page.
`GET /internal/v1/search-membership` requires an authenticated user and organization delegated
by Search. One tenant snapshot returns the active membership ID, role and membership version.

Billing uses `GET /internal/v1/billing-organizations` with the Billing system identity and no
organization claim. `GET /internal/v1/billing-memberships` requires the Billing identity
with an organization claim and returns the active and removed member versions for that tenant.
Notification uses `GET /internal/v1/quota-notification-recipients` and
`POST /internal/v1/quota-notification-recipients/lookup` with its system identity and an
organization claim. The list pages the current owners and administrators. The lookup rechecks
candidate user IDs before delivery. All four operations send `Cache-Control: private, no-store`,
including authentication errors.

The API Gateway calls `POST /internal/v1/automation-recipients/check` with a signed user and
the selected organization. One tenant statement checks the caller's current owner or admin role
and the recipient's active membership. The private, uncacheable response contains only
`{ eligible }`. Task remains responsible for the recipient's visibility and assignment eligibility
when Automation runs an action.

When Free seat admission is enabled, accepting an invitation that adds a billed seat and
promoting a guest share one tenant transaction lock. The transaction counts active billed
roles after acquiring the lock and returns `409 organization.seat-quota-exceeded` above
five seats. Invitations and guests do not reserve seats. A refused mutation emits no fact.

| Route                                                      | Organization | Success                 | Refusals                                                                                                                                                  |
| ---------------------------------------------------------- | ------------ | ----------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `POST /internal/v1/organizations`                          | None         | 201, `Location`, `ETag` | 400, 404 `user.not-synchronized`, 409 `organization.slug-taken`, 422 `organization.slug-invalid`                                                          |
| `GET /internal/v1/organizations`                           | None         | 200                     | 400                                                                                                                                                       |
| `GET /internal/v1/organization`                            | Required     | 200, `ETag`             | 404 `organization.not-found`                                                                                                                              |
| `PATCH /internal/v1/organization`                          | Required     | 200, `ETag`             | 400, 403 `organization.role-forbidden`, 404, 409 `organization.slug-taken`, 412 `request.version-mismatch`                                                |
| `POST /internal/v1/organization/logo/uploads`              | Required     | 201, `Location`         | 400, 403, 404, 409 key reuse, 422 unsupported declaration or size                                                                                         |
| `GET /internal/v1/organization/logo/uploads/{uploadId}`    | Required     | 200                     | 400, 403, 404, 409 expired or superseded                                                                                                                  |
| `PUT /internal/v1/organization/logo`                       | Required     | 204, `ETag`             | 400, 403, 404, 409 expired or superseded, 412 `request.version-mismatch`                                                                                  |
| `DELETE /internal/v1/organization/logo`                    | Required     | 204, `ETag`             | 400, 403, 404, 412 `request.version-mismatch`                                                                                                             |
| `GET /internal/v1/members`                                 | Required     | 200                     | 400, 403 `organization.role-forbidden`, 404 `organization.not-found`                                                                                      |
| `POST /internal/v1/member-names/lookup`                    | Required     | 200                     | 400, 404 `organization.not-found`                                                                                                                         |
| `GET /internal/v1/members/{memberId}`                      | Required     | 200, `ETag`             | 400, 403, 404 `member.not-found`                                                                                                                          |
| `PATCH /internal/v1/members/{memberId}`                    | Required     | 200, `ETag`             | 400, 403, 404, 412 `request.version-mismatch`, 422 `member.owner-protected`                                                                               |
| `DELETE /internal/v1/members/{memberId}`                   | Required     | 204                     | 400, 403, 404, 422 `member.owner-protected`                                                                                                               |
| `POST /internal/v1/invitations`                            | Required     | 200                     | 400, 403, 404 `organization.not-found`, 429 `invitation.daily-limit-reached`                                                                              |
| `GET /internal/v1/invitations`                             | Required     | 200                     | 400, 403, 404                                                                                                                                             |
| `DELETE /internal/v1/invitations/{invitationId}`           | Required     | 204                     | 400, 403, 404 `invitation.not-found`, 409 `invitation.answered`                                                                                           |
| `POST /internal/v1/invitations/{invitationId}/resend`      | Required     | 200, `ETag`             | 400, 403, 404, 409 `invitation.revoked`, `invitation.answered`, 429 `invitation.resend-throttled`, `invitation.daily-limit-reached`                       |
| `GET /internal/v1/users/{userId}/invitations`              | None         | 200                     | 400, 404 `user.not-found`                                                                                                                                 |
| `POST /internal/v1/users/{userId}/invitations/{id}/accept` | None         | 200                     | 400, 403 `invitation.email-mismatch`, 404 `invitation.not-found`, `user.not-found`, 409 `invitation.revoked`, `invitation.answered`, `invitation.expired` |
| `POST /internal/v1/users/{userId}/invitations/{id}/refuse` | None         | 204                     | As the acceptance                                                                                                                                         |

`Member` carries `twoStepVerificationEnabled`, from the user directory, only when the actor is the
owner or an admin: in the list, the reading of a member and the answer of a change of role (which
only they make). For any other actor the field is absent from the answer, never `null` nor
`false` (`openapi/internal/organization-service.yaml`, `Member`); the gateway passes it on as is.

The member-name lookup accepts one to 5,000 account IDs for the gateway's authorized CSV export.
Every current member, including a guest, may call it. It returns only account IDs and full names
for current members of the same organization, omitting unavailable names and departed accounts.
The actor membership and names are read in one tenant snapshot.

The organization profile includes the current opaque `logoId`. Logo reservation and owner
mutation responses use `Cache-Control: no-store`, including malformed bodies and guard refusals.
The gateway asks Storage to prepare a pending upload before publication. A committed retry
returns the current profile ETag without reactivating the reservation's earlier asset.

Every route also answers the 401 and 403 of the internal token guard. The titles are the English
reason phrases; the gateway answers the French titles of the public specs. A 429 carries
`Retry-After`, the seconds until `details.resendAvailableAt` or `details.nextAvailableAt`, rounded
up and 1 at least. The gateway relays the two 429 codes only once it lists them: it must ship them
in the same deployment as this module or before, otherwise they reach the browser as 503.

## Events emitted

All appended to the outbox in the transaction of the change, with the organization of the change
and the version of the aggregate after it; none is restricted.

| Event                                   | When                                                             | Actor                    | Version           |
| --------------------------------------- | ---------------------------------------------------------------- | ------------------------ | ----------------- |
| `organization.created.v1`               | An organization is created                                       | The creator, its owner   | 1                 |
| `organization.updated.v1`               | A patch of the organization moves something (`changed`)          | The owner or the admin   | Organization's    |
| `organization.logo-changed.v1`          | The active logo reference is set, replaced or removed            | The owner or the admin   | Logo generation   |
| `organization.logo-upload-abandoned.v1` | An unusable pending reservation becomes terminal                 | Organization service     | 1                 |
| `member.joined.v1`                      | The owner at the creation; an account that accepts an invitation | The account that joined  | 1                 |
| `member.role-changed.v1`                | A member gets another role                                       | The owner or the admin   | Membership's (2+) |
| `member.removed.v1`                     | A member is removed, or an account is deleted; its last event    | Owner, admin or system   | Membership's (2+) |
| `invitation.issued.v1`                  | An invitation is created (batch or creation form) or resent      | The sender, also inviter | Invitation's      |

Revoking and refusing emit nothing; a patch or a role change that moves nothing emits nothing.
The removals of a deleted account carry the actor `{ type: 'system', id: 'organization-service' }`
(`asyncapi/organization-service.yaml`), one event per organization, appended in the system
transaction of the removal.
The language of `invitation.issued.v1` is the default language of the organization. No rebuild
use case exists yet: identity-service, the one consumer of the membership events today, reads
the seven days the stream holds when it starts; a consumer that needs the memberships beyond them
(the permissions already allow `rebuild.*.member`) needs a rebuild item schema in
`@cadenway/contracts` and a re-emission use case here, with `RebuildEmitter`.

## Offline membership export

For offline Task restoration, the following command streams active membership generations and
tombstones from the Organization database in pages of 500.

```sh
node --import @cadenway/nest-common/register \
  dist/modules/organizations/infrastructure/adapters/membership-export/export-memberships.js
```

The command uses one read-only repeatable-read transaction under the service role. Its
newline-delimited JSON records include the organization, membership and account IDs, role,
version and timestamps. The closing count is written after the database snapshot closes.
Ops protects the stream between the Organization exporter and the Task importer.

## Events consumed

| Event                                   | Durable consumer                                     | Effect                          |
| --------------------------------------- | ---------------------------------------------------- | ------------------------------- |
| `user.signed-up.v1`                     | `organization-service__project-user-signed-up`       | Name and address, not verified  |
| `user.email-verified.v1`                | `organization-service__project-user-email-verified`  | Verified address                |
| `user.profile-updated.v1`               | `organization-service__project-user-profile-updated` | Name                            |
| `user.email-changed.v1`                 | `organization-service__project-user-email-changed`   | Verified address                |
| `user.two-step-verification-changed.v1` | `organization-service__project-user-two-step`        | Two-step verification on or off |
| `user.deleted.v1`                       | `organization-service__remove-deleted-user`          | Memberships removed, forgotten  |

- Each handler starts from what `EVENTS` still holds (`deliverPolicy: 'all'`): a new deployment
  learns the accounts of the last seven days before it started, not only the next ones.
- The deduplicator of `OutboxModule` records `(consumer, event id)` in `processed_events` in the
  system transaction of the delivery, with the effect: a redelivery is skipped. The events travel
  on separate subjects and consumers, so `claimVersion` (per consumer) cannot order them: each
  part of an entry keeps the version of the account that set it (`name_version`, `email_version`,
  `two_step_verification_version`) and an older event never overwrites a newer one, whatever the
  order of arrival. `user.email-changed.v1` sets the address, verified, by version, as
  `user.email-verified.v1` does; its name, device and previous address are for
  notification-service and are not read.
- `user.two-step-verification-changed.v1` sets `two_step_verification_enabled` from its `enabled`,
  by version, whatever its `change` (a value this service does not know included, as the contract
  asks), for the column "Deux étapes"; an account no such event reached is `false`. **Data
  minimisation**: the handler reads `userId`, `version` and `enabled` only. The device and the IP
  address (`client`), the address and the name (`recipient`), the language, the time zone, the
  methods, the backup codes left and the security key are for the email of notification-service:
  they are never passed to the use case, stored, nor logged here (the kit logs no payload). They
  still reach this service on the wire, and a dead letter of this consumer keeps the whole message
  in `EVENTS_DLQ` (30 days), as for every event of `EVENTS` (the kit drops the body of restricted
  events only): an open question left to the user in P2c-2, for cadenway-api-contracts,
  cadenway-service-kit and cadenway-ops.
  Accounts that turned two-step verification on before the stream retention of their event and
  before this module first consumed it stay `false` until their next change (see "Beyond the
  retention of the stream"). **Deployment prerequisite**: this module's release runs in an
  environment before the gateway exposes the setup routes of two-step verification there, so that
  no such account exists; nothing here enforces it.
- `user.deleted.v1` (decision 9 of P2c), in one system transaction: the directory entry is locked,
  every active membership of the account is locked and removed with its `member.removed.v1`, and
  the entry forgets the name, the address and the two-step verification and becomes a former
  member (`deleted`), its versions raised to the one of the deletion. A deleted entry ends the
  work at once, so the same deletion applied again, under another event id, changes nothing; no
  later event of the account applies, whatever its version, so a late event never brings it back.
  A deletion a replica of the previous release applies during the rollout leaves
  `two_step_verification_enabled` as it was: the entry has no membership left, so the flag is never
  answered; a later release may clear such rows in batches.
- The entry is locked (`select … for update` after an `insert … on conflict do nothing`), so two
  events of one account apply one after the other. The acceptance of an invitation and the
  creation of an organization hold the entry of their actor in share mode (`select … for share`)
  until they commit, before they write a membership: a deletion under way is waited for, then
  leaves no verified address (`invitation.not-found`) nor synchronized account
  (`user.not-synchronized`), and a deletion that comes later waits for them and finds the new
  membership (the owner of a new organization refuses it).
- The directory decides which account accepts an invitation, so a failing event is not given up
  before 24 hours (decision 3 of the P2b security follow-ups): the three directory consumers retry
  on `DIRECTORY_REDELIVERY` (`application/models/directory/`), 1 s, 5 s, 30 s, 2 min, 10 min,
  30 min, then every hour, 32 deliveries, about 25 h 43 min before the dead letter, the schedule
  the README of `@cadenway/nest-messaging` gives for security projections. The two consumers of P2c
  use the same schedule: the address decides which account accepts an invitation, and the
  deletion stops the access of the account to its organizations (identity-service stops it on
  `member.removed.v1`). So does the consumer of P2c-2: the owner and the admins read the two-step
  verification of their members from it, a security signal a lost event would misreport. The kit
  applies it with `nak(delay)` and sets `max_deliver` to 32 on each consumer when the service
  starts, in place.
  **A rollout of this schedule, or of any change to it, must replace every replica**: a replica
  still on the previous limit (5 deliveries) treats its own last delivery as final and can use up
  the remaining deliveries at once, and sets `max_deliver` back when it restarts.
- A dead letter of these consumers is replayed by an operator once its cause is fixed; applying an
  event twice changes nothing.
- The NATS user `organization` may create, read, pull from and acknowledge on these six consumers
  only, each by its exact name and filter (cadenway-ops, `docs/messaging.md`); `compose.dev.yaml`
  grants the same, so a handler without its grant fails to start in the integration tests. A new
  handler gets its consumer granted in cadenway-ops before the release that adds it: the grants of
  `project-user-email-changed` and `remove-deleted-user` are deployed before this module's release
  that subscribes them, and the grant of `project-user-two-step` (filter
  `evt.user.two-step-verification-changed.v1`) before the release that subscribes it.

**Beyond the retention of the stream.** An account whose events left `EVENTS` (seven days) before
this service first consumed them, or a directory lost and recreated, is not recovered by the
stream. The kit's rebuild fits (identity-service would re-emit its accounts with `RebuildEmitter`
on `rebuild.organization.user`, which the `organization` user may subscribe to, and this module
would apply each item with `onRebuild`), but no rebuild item schema of the accounts exists in
`@cadenway/contracts` and identity-service has no rebuild use case: **open decision**, reported to
cadenway-api-contracts and identity-service. Until then, a directory entry missing for an old
account answers `404 user.not-synchronized` at the creation of an organization, and an empty list
of received invitations.

## Logo reservation expiry

The system schedule `organization.expire-logo-uploads` runs each minute in UTC. A bounded,
read-only system query selects up to 100 expired pending reservations by deadline. Each candidate
is rechecked under the organization and reservation locks in a separate tenant transaction. The
terminal state and `organization.logo-upload-abandoned.v1` commit together. Repeating the sweep
does not publish again. A stopped worker leaves the next tick to pick up remaining rows. An
operator checks the failed job's error, fixes the cause and requeues the sweep after an exhausted
retry. Storage uses the authoritative abandonment fact to reclaim the associated bytes.

## Invariants

- Roles (decision 1 of P2b): the owner and the admins update the organization, invite, see and
  manage the pending invitations, change roles and remove members, and see which members have
  two-step verification; members read the member list without it; guests do not read it
  (`403 organization.role-forbidden`). The owner is the creator and the only one; nobody changes
  their role or removes them (`422 member.owner-protected`) and nobody becomes owner
  (`role: owner` is refused by the contract schema). Decided from this module's members, never
  from the role or the scopes of the token.
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
- The email of an invitation goes out at most once an hour: a resend less than an hour after its
  `sentAt` (the issue or the previous resend) answers `429 invitation.resend-throttled` with
  `details.resendAvailableAt`, `sentAt` plus one hour, checked after the invitation is found and
  pending (decision 1 of the P2b security follow-ups).
- An organization causes at most 100 invitation emails in any 24 hours: each `invited` address of a
  batch or of the creation and each resend takes one. Once the role is accepted, a batch whose
  addresses to invite need more than what remains, or a resend with none left (after the hour
  rule), answers `429 invitation.daily-limit-reached` with `details.remaining` (`0` or more) and
  `details.nextAvailableAt` (the oldest email counted plus 24 hours), and writes, sends and emits
  nothing. A batch that invites nobody is never refused. The creation is never refused (50
  addresses at most) but counts.
- An invitation is accepted or refused only by the account whose verified address, in the
  directory, is the invited address (decision 5); the checks run in the order of the contract, and
  the address is checked again under the lock of the invitation.
- A cursor is unsigned: its id must be a UUID and its key the sort key of its list (an instant for
  the invitation lists), else `400 request.invalid`, the code of the contract. The kit answers a
  malformed cursor and a malformed `If-Match` with that code itself; this module answers it for
  the checks it makes on a decoded position.
- Every refusal answers a code the operation declares in `openapi/internal/organization-service.yaml`
  (`tests/organizations.int-spec.ts` checks each error response against it); a stale `If-Match`
  answers `412 request.version-mismatch` with `details.version`.
- The directory applies each part of an account by version; a directory entry is never deleted.
- A deleted account (`user.deleted.v1`) keeps its entry without name, search key nor address
  (checked by a constraint), is never synchronized again, has no verified address and so answers
  no invitation, and has no active membership: its removal and the forgetting commit together.
  Wherever it still appears, its name is « Ancien membre » (the mockup: "attribués à « Ancien
  membre »"): today the sender of a pending invitation (`invitedBy.name`), in the pending list and
  in the invitations received.
- The pending invitations a deleted account sent stay pending, with their sender: the contract
  withdraws none, they belong to their organization, and an owner or an admin still revokes or
  resends them (a resend names the one who resends in its email).
- A deletion of an account that owns an organization here, which the contract excludes, is refused
  as a whole (`DeletedOwnerRefusal`): nothing is removed nor forgotten, no organization loses its
  owner. The delivery fails, is logged with the ids of the event, the account and the
  organizations, is retried on `DIRECTORY_REDELIVERY` and becomes a dead letter.
- Never logged by this module: an address, a name, a token.

## Transactions

`DrizzleOrganizationsUnitOfWork` runs organization, member and invitation use cases in the kit's
transactions. It runs invitation acceptance and refusal in two (a read-only check, then the write).
The Search readers open their snapshots directly with the kit's transaction runners:

- Tenant transaction of the organization of the token: reading and patching the organization,
  every member and invitation route. The membership of the actor, the change, its version check
  and its event commit together.
- `GET /internal/v1/search-membership` opens a tenant `REPEATABLE READ READ ONLY` transaction and
  reads the active membership of the delegated user in the token's organization.
- The batches and the resends of an organization run one after the other: the check of the daily
  allowance locks the row of the organization (`select … for no key update`) until the end of the
  transaction, then counts the ledger, so two concurrent requests cannot both pass on the same
  remaining emails. The lock leaves the key of the organization alone: the foreign keys of
  concurrent inserts (an acceptance writing a membership) do not wait on it, while a patch of the
  organization (`for update`) waits for it and the reverse. Every writer of the ledger locks the
  organization before an invitation (the resend: organization, then the invitation), so the locks
  are always taken in that order. The count is a statement of its own after the lock, so it sees
  what the previous holder committed under READ COMMITTED, the isolation the kit's runners open; a
  runner opened at REPEATABLE READ would break the check. The creation writes the ledger of an
  organization nobody else can see yet and takes no lock. A request waiting on the lock longer
  than the `lock_timeout` of the application role (5 s) fails with a 500.
- System transaction, the **bounded exceptions** of decision 9, each with explicit filters:
  - the creation of an organization: the organization does not exist before it and PostgreSQL
    assigns its id on insert, so no tenant transaction can hold it; it writes the rows of the new
    organization only (its owner, its invitations, its outbox rows, which the kit accepts in a
    system transaction) and reads the directory entry of the actor, held in share mode until it
    commits;
  - the list of the organizations of the actor: a read-only query filtered on `members.user_id`;
  - the invitations addressed to the actor: a read-only query filtered on the verified address
    of the actor's directory entry;
  - the first checks of an answer to an invitation: a read-only lookup of one invitation by id
    and of the actor's directory entry;
  - `GET /internal/v1/search-organizations`: a `REPEATABLE READ READ ONLY` export of at most 100
    active organization IDs per page up to the first snapshot's high-water UUID. Only the
    `search-service` system actor in a token with a null organization can open this transaction;
  - the projection of the directory: one entry by its account id, in the transaction of the
    deduplicator;
  - the removal of a deleted account: its directory entry and its active memberships in every
    organization, filtered on the account (`members_user_active_index`), locked by organization then
    id, with one `member.removed.v1` per organization, in the transaction of the deduplicator, since
    the event belongs to no organization and the kit opens no tenant transaction inside a system
    one.
- Tenant transaction of the organization of an invitation (`runInOrganizationOf`, which takes the
  stored invitation, never an id): the acceptance and the refusal lock the invitation and check its
  address and state again there, as the contract requires; the acceptance first holds the directory
  entry of the actor in share mode (no row-level security on it), then writes the membership and
  `member.joined.v1`.

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
- A malformed cursor or `If-Match` answers `400 request.invalid` from the kit itself since
  `@cadenway/nest-common` 0.6.0 (decision 5 of the P2b security follow-ups); this module no longer
  maps the former kit codes. The generated query validators of `@cadenway/contracts` 0.6.0 read
  `limit` from its text, so the module keeps only its splitting of `role`.
- The invitation email limits, decision 1 of the P2b security follow-ups, as
  `openapi/internal/organization-service.yaml` of `@cadenway/contracts` 0.6.0 describes them (the
  user may revise them): one email an hour per invitation, counted from its `sentAt`; 100 per
  organization in any 24 hours, issues, creation invitations and resends together; a batch over
  what remains refused as a whole. Choices made here:
  - the ledger `invitation_emails` counts the emails, since `sentAt` is overwritten by a resend;
    it holds no address, and its rows are purged by the next batch or resend of their
    organization rather than by a job;
  - the check is serialized per organization by a row lock on the organization, not an advisory
    lock (no shared key space to coordinate) nor a constraint (a count over a window is no
    constraint);
  - the order of the refusals of a resend follows the contract: found, pending, the hour, then
    the allowance;
  - `Retry-After` is computed when the refusal is answered, from the instant of the details, as
    identity-service does.
  - Known limit, as the contract defines the hour per invitation: revoking an invitation and
    inviting the address again sends a new email at once, within the daily allowance, and each new
    organization starts with its own 100. A per-address hour and a limit on creations need the
    contract first; reported to cadenway-api-contracts and the gateway.
- The account changes of P2c, decision 9 of its brief (the user may revise them):
  - `user.email-changed.v1` updates the address of the directory, verified, by the version of the
    account, like the other directory events;
  - `user.deleted.v1` removes every membership of the account, each with `member.removed.v1` from
    the system, and keeps the account as a former member shown as « Ancien membre »;
  - its pending invitations are kept, not revoked (see Invariants): `user.deleted.v1` and
    `openapi/internal/organization-service.yaml` list what this service does on a deletion, and
    withdrawing invitations is not part of it; a revocation emits nothing, so the organization
    would see them disappear without a trace; the open question of the contracts was what
    `inviter.name` shows, answered « Ancien membre »;
  - a deleted account is forgotten by the directory only: a removed membership keeps the id of the
    invitation it accepted, and that invitation keeps the address it was sent to, the record of the
    organization; the contract promises the forgetting of the directory, not of the invitations;
  - a verified address moves between accounts with `user.email-changed.v1` and comes free again
    with `user.deleted.v1`. The versions order the events of one account only, so while the change
    of the account that leaves an address is not applied yet (retried, or a dead letter), the
    account that takes it and the one that left it can both hold it verified, and both list and
    answer its invitations. identity-service never lets two accounts verify one address, so the
    window lasts as long as the event of the leaving account waits; a unique address would turn it
    into a projection that fails until then, which this module does not do;
  - the deletion of an owner is refused and becomes a dead letter rather than applied without the
    owner membership: the event contradicts the contract, so identity-service and this service
    disagree on who owns the organization; applying it in part would hide that and leave an
    organization owned by an account nobody can sign in to, with no ownership transfer yet.
    Retrying cannot succeed until an operator settles the ownership, then replays the dead letter;
    until then the account keeps its memberships and its directory entry here, while
    identity-service has already revoked its sessions and tokens.
- The two-step verification of P2c-2, as `@cadenway/contracts` 0.8.0 describes it (the user may
  revise it):
  - the directory keeps `enabled` alone, by the version of the account like the other parts, in a
    part of its own (`two_step_verification_version`), so a two-step event never reorders the name
    or the address; the rest of the event is not read (data minimisation, see Events consumed);
  - the field is decided in the use cases from the role of the actor in this module's members
    (`seesTwoStepVerification`): the repositories always read it, and `toMemberViewFor` drops it
    for anyone but the owner and the admins, before the answer is built. The answer of a change of
    role carries it too, since `Member` says "present when the actor is the owner or an admin" and
    only they change a role (the role checked is the actor's before the change). Known limit: the
    repositories fill it for every reader, so a new use case that returns members must pass them
    through `toMemberViewFor` too, or it answers the flag to members;
  - a deleted account forgets its flag with its name and address: it has no membership left to
    show it on.
- `tests/organizations.int-spec.ts` proves every route, the isolation, the role rules, the
  invitation lifecycle, the invitation email limits (with two concurrent batches), the events in
  the stream, the directory projection from events published before the service started and their
  redelivery, and the rollback, on real PostgreSQL and NATS. `tests/account-changes.int-spec.ts`
  proves the change of address in the member list and the deletion of an account (memberships,
  events from the system, pending invitations and their resend, an acceptance during a deletion,
  redeliveries). `tests/directory-redelivery.int-spec.ts` proves the redelivery schedule of the
  directory consumers with a short schedule, and the deletion of an owner refused until its dead
  letter. `tests/two-step-verification.int-spec.ts` proves the flag of the directory in the order of
  the versions (an event published before the service started included), redeliveries and
  re-emissions without effect, that nothing but the flag is stored, and that the owner and the
  admins see it while a member does not and a guest reads no member.
