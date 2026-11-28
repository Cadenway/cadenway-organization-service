# Organizations

## Purpose

Organizations and who belongs to them, for P2b of the plan and the account changes of P2c and
P2c-2:

- organizations: profile ("Profil de l'organisation": name, address slug, description, website,
  default language and logo), the effective plan projected from Billing, the answers of the creation form
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
| `organization_seat_entitlements` | `organization_id`, one versioned Billing seat projection                         | `organization_id`, policy forced                       |
| `invitation_emails`              | `id`; one row per invitation email sent                                          | `organization_id`, policy forced                       |
| `invitation_sender_emails`       | `id`; one row per email, with a sender ID and timestamp only                     | `sender_id`, policy forced                             |
| `invitation_batch_replays`       | (`organization_id`, `actor_user_id`, `key_digest`), one per scoped batch key     | `organization_id`, policy forced                       |
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

`migrations/0008_invitation_sender_budget.sql` adds the account-scoped ledger. It records the
verified account that actually sent each email, including a resend by a different administrator.
The account's next send drops expired rows under its transaction lock. The tenant ledger retains
its existing semantics and earlier entries. The sender ledger starts counting with the first
version that writes it, since earlier entries do not identify the sender of each email.

`migrations/0012_invitation_batch_replays.sql` adds the replay records of the invitation batches
sent with an `Idempotency-Key`: the SHA-256 digest of the key, never the key, the SHA-256
fingerprint of the canonical batch (`request_digest`: the role and the distinct addresses in
order), never the batch, the `200` outcome to replay (`outcome`) and `expires_at`, 24 hours after
the insert of the record on the database clock (`clock_timestamp()`), which the live read uses too;
the purges compare with `statement_timestamp()`, fixed for their statement, so they range-scan the
expiry indexes. **`outcome` holds the invited addresses**, the body the contract replays, until the
record is purged: 24 hours, plus the delay of the purge. A record is written once, in the
transaction of its batch, and never changed. Two purges delete expired records, both bounded: each
delete selects, limits and locks its candidates once in a materialized CTE, then deletes them by
primary key, since a `LIMIT` inside an `IN (subquery)` may be evaluated again by a semi-join.

- a keyed batch deletes its own key's expired record and at most 10 other expired records of its
  organization (`invitation_batch_replays_organization_expiry_index`, `skip locked`), so it never
  holds its allowance locks for a long delete;
- the system job `organization.purge-invitation-batch-replays` runs each minute, whatever the
  tenants' traffic: bounded deletes of at most 500 expired records of any organization
  (`invitation_batch_replays_expiry_index`, oldest first, `skip locked`), each in its own system
  transaction, one after the other until one deletes fewer than 500 or 5 seconds have passed (under
  the 8 s shutdown timeout of the job runtime). Each call gets the absolute deadline of the tick
  (less the last 500 ms, kept for the read of the backlog) and the job's abort signal. The wait
  for a pooled connection races both: if either comes first, the call answers at once, and the
  transaction, whenever it gets its connection, runs no statement and ends, giving it back. A
  transaction that gets its connection in time sets the time left as its `statement_timeout`, then
  checks the deadline and the abort once more right before its statement, which it skips if either
  came meanwhile; the statement can thus overrun the deadline by one `set_config` round trip at
  most. A delete cut short rolls back and fails the tick, which its queue retries.
  A keyed batch stores a record even when it sends
  nothing, so the email allowance does not bound how many records expire; a tick that stops on its
  budget logs, at `warn`, the rows it deleted and `oldestExpiredAgeSeconds`, the backlog, and the
  next tick continues. A failed tick is retried by its queue, which the migrator provisions with
  the others.

The migration is additive: the previous release never reads the table, and a rollback keeps it
(see "Rollout and rollback of idempotent batches").

`0005_organization_logo` adds the nullable opaque `organizations.logo_id`, an independent
`logo_generation` and tenant-owned upload reservations. A reservation binds the uploader,
declaration and generation for up to five minutes. Its optional 24-hour replay record holds a
digest of the key. Storage owns the bytes and signed transfers.

`0006_billing_membership_index` adds `(organization_id, id)` for a bounded snapshot that includes
removed memberships. The Billing reader returns member IDs and source versions with the role of
active memberships. The Notification reader returns current owner and administrator user IDs
from the existing active-member index. Their HTTP adapters use the published service contracts.

`0007_organization_seat_entitlements` adds the seat projection. An absent row represents Free
version zero and five seats, so existing organizations need no backfill. The expansion leaves the
previous application working. Deploy the migration before new replicas and keep the table during
rollback. Plan fields on existing organization responses retain their current source.

## API

From `openapi/internal/organization-service.yaml` of the installed `@cadenway/contracts`; issuer
`api-gateway`, actor `user`. "Required" routes act on the organization of the internal token in its
tenant transaction; "none" routes ignore it.

Search and Identity use two private, uncacheable routes. `GET /internal/v1/search-organizations`
requires the signing service's own system identity without an organization claim and exports only
organization IDs. It resumes within the authenticated upper bound of the first page.
`GET /internal/v1/search-membership` requires a signed user actor and organization. One tenant
snapshot returns the active membership ID, role and membership version. Task and Realtime can
call only this membership route. Identity, Task and Realtime sign it without a delegated role
or scopes.

Billing uses `GET /internal/v1/billing-organizations` with the Billing system identity and no
organization claim. `GET /internal/v1/billing-memberships` requires the Billing identity
with an organization claim and returns the active and removed member versions for that tenant.
`GET /internal/v1/billing-active-seats` uses the same scoped identity to return the current
billable count in one read. Checkout is independent of the retained membership history.
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

When seat admission is enabled, accepting an invitation that adds a billed seat and promoting
a guest share one tenant transaction lock. After acquiring the lock, the transaction reads the
current projected limit and counts active owners, admins and members. It returns
`409 organization.seat-quota-exceeded` when no seat remains. Existing active memberships keep
their roles on acceptance. Pending invitations and active guests do not take seats. A refused
mutation emits no fact.

Organization profiles, the organization's list entry and accepted invitations read the
current Billing plan from the same seat entitlement table. An organization without a projection
starts on Free. The original organization row keeps its creation plan for older images and
does not take part in these reads.

The internal `ApplySeatEntitlement` operation uses the same lock to classify a verified Billing
snapshot and apply it atomically using a one-row compare-and-set on the version classified.
It keeps the projection for identical replays and refuses older or conflicting same-version
values. Only a newer canonical Free snapshot of five seats and 2,000,000,000 bytes can decrease
the seat limit. This remains true if the consumer missed an intervening plan version. Existing
members keep their access if the organization is over the reduced limit.

| Route                                                      | Organization | Success                 | Refusals                                                                                                                                                  |
| ---------------------------------------------------------- | ------------ | ----------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `POST /internal/v1/organizations`                          | None         | 201, `Location`, `ETag` | 400, 404 `user.not-synchronized`, 409 `organization.slug-taken`, 422 `organization.slug-invalid` or `organization.slug-reserved`                          |
| `GET /internal/v1/organizations`                           | None         | 200                     | 400                                                                                                                                                       |
| `GET /internal/v1/organization`                            | Required     | 200, `ETag`             | 404 `organization.not-found`                                                                                                                              |
| `PATCH /internal/v1/organization`                          | Required     | 200, `ETag`             | 400, 403 `organization.role-forbidden`, 404, 409 `organization.slug-taken`, 412 `request.version-mismatch`, 422 `organization.slug-reserved`              |
| `POST /internal/v1/organization/logo/uploads`              | Required     | 201, `Location`         | 400, 403, 404, 409 key reuse, 422 unsupported declaration or size                                                                                         |
| `GET /internal/v1/organization/logo/uploads/{uploadId}`    | Required     | 200                     | 400, 403, 404, 409 expired or superseded                                                                                                                  |
| `PUT /internal/v1/organization/logo`                       | Required     | 204, `ETag`             | 400, 403, 404, 409 expired or superseded, 412 `request.version-mismatch`                                                                                  |
| `DELETE /internal/v1/organization/logo`                    | Required     | 204, `ETag`             | 400, 403, 404, 412 `request.version-mismatch`                                                                                                             |
| `GET /internal/v1/members`                                 | Required     | 200                     | 400, 403 `organization.role-forbidden`, 404 `organization.not-found`                                                                                      |
| `QUERY /internal/v1/members`                               | Required     | 200                     | 400, 403 `organization.role-forbidden`, 404 `organization.not-found`                                                                                      |
| `POST /internal/v1/member-names/lookup`                    | Required     | 200                     | 400, 404 `organization.not-found`                                                                                                                         |
| `GET /internal/v1/members/{memberId}`                      | Required     | 200, `ETag`             | 400, 403, 404 `member.not-found`                                                                                                                          |
| `PATCH /internal/v1/members/{memberId}`                    | Required     | 200, `ETag`             | 400, 403, 404, 412 `request.version-mismatch`, 422 `member.owner-protected`                                                                               |
| `DELETE /internal/v1/members/{memberId}`                   | Required     | 204                     | 400, 403, 404, 422 `member.owner-protected`                                                                                                               |
| `POST /internal/v1/invitations`                            | Required     | 200                     | 400, 403, 404 `organization.not-found`, 409 `idempotency.request-in-progress`, 422 `idempotency.key-reused`, 429 `invitation.daily-limit-reached`         |
| `POST /internal/v1/invitation-batches`                     | Required     | 200                     | As above; 400 also without `Idempotency-Key`, which it requires                                                                                           |
| `GET /internal/v1/invitations`                             | Required     | 200                     | 400, 403, 404                                                                                                                                             |
| `GET /internal/v1/invitations/{invitationId}`              | Required     | 200, `no-store`, no tag | 400, 403, 404 `invitation.not-found` or `organization.not-found`                                                                                          |
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

### Rollout and rollback of idempotent batches

A release before this one ignores `Idempotency-Key` on `POST /internal/v1/invitations`: behind it,
a retried keyed batch would run again, send its emails again, charge the allowances again, and
could invite again an address whose invitation was revoked meanwhile. So keyed batches have a route
of their own (`@cadenway/contracts` 0.46.0), `POST /internal/v1/invitation-batches`, which requires
the key and which only a release that replays serves:

- the gateway sends `POST /v1/invitations` with `Idempotency-Key` to
  `POST /internal/v1/invitation-batches`, and without the key to `POST /internal/v1/invitations`;
- a `404` from the keyed route whose code is not `organization.not-found` means the replica that
  answered has no replay support (a previous release has no such route): the gateway answers
  `503 upstream.unavailable` (`details.service`: `organization-service`) with `Retry-After`, and
  the client retries the same key later, never as a fresh batch;
- both routes share one key namespace, the same replay records and the same in-progress claim,
  scoped to the organization, the actor and the invitation of members, never to a route: a key
  used on `POST /internal/v1/invitations` before the gateway moved replays, conflicts or waits on
  the keyed route for its whole replay window, and the reverse. The former route keeps accepting
  the optional key with the same behavior.

1. Deploy this release (migration `0012` first, as every migration) in the environment.
2. Then the gateway may send keyed batches to the keyed route and expose
   `GET /v1/invitations/{invitationId}`; a replica of the previous release still running during
   the rollout answers the keyed route `404`, which becomes the retryable `503`.
3. To roll this service back below this release, roll it back: the previous release answers the
   keyed route `404` by construction, so keyed requests get the retryable `503` while it runs,
   and requests without the key keep working. Keep `invitation_batch_replays`: the previous
   release never reads it. Rolling forward again restores the replays of the records still live;
   no keyed batch ran in between.
4. Once no replica of this release runs (a replica that starts registers the schedule again),
   clean up what the previous release leaves behind, since it has no purge worker:
   - remove the persisted schedule of `organization.purge-invitation-batch-replays`, which would
     otherwise create a job every minute that nobody consumes. The kit offers it as
     `JobScheduler.unschedule('organization.purge-invitation-batch-replays', { key: 'minutely' })`
     only, with no command line, and the previous release does not call it; run its exact
     statement as `organization_migrator`, which owns the `pgboss` schema:

     ```sql
     DELETE FROM pgboss.schedule
     WHERE name = 'organization.purge-invitation-batch-replays' AND COALESCE(key, '') = 'minutely';
     ```

   - delete the expired replay records, which hold invited addresses, as `organization_migrator`
     under the system access of the row-level security policy. The statement never touches a live
     record; run it once right after the rollback and again 24 hours later, when every record
     written before the rollback has expired (the table then stays empty, since the previous
     release writes none):

     ```sql
     BEGIN;
     SELECT set_config('app.system_access', 'on', true);
     DELETE FROM invitation_batch_replays WHERE expires_at < clock_timestamp();
     COMMIT;
     ```

   Both statements are idempotent. The provisioned queue may stay: without its schedule it gets no
   new job. Rolling forward again needs neither undone: the new replicas register the schedule at
   start-up.

A previous release also answers `getInvitation` `404` (`invitation.not-found` is not its code
there, the route does not exist): the gateway exposes `GET /v1/invitations/{invitationId}` once
this release runs in the environment.

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
The language of `invitation.issued.v1` is the default language of the organization.

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
  leaves a tombstone (`invitation.not-found`) and no synchronized account
  (`user.not-synchronized`), and a deletion that comes later waits for them and finds the new
  membership (the owner of a new organization refuses it).
- `ReserveAccountDeletion` uses a system transaction restricted to one account. It locks that
  account's directory entry, checks its active owner memberships, and stores the first deletion
  attempt in the nullable `directory_users.deletion_attempt_id` added by migration `0009`.
  Organization creation and invitation acceptance check the reservation under their shared
  directory lock. Migration `0011` also rejects new active memberships, restorations of removed
  memberships and promotions to owner for reserved or deleted accounts. The trigger holds the same
  directory lock so the check also covers writes from a previous application image. Retrying the
  same attempt reuses the reservation until the deletion event commits. A definitive owner refusal
  includes up to 100 ordered organization IDs as evidence. The unscoped Identity system actor calls
  `PUT /internal/v1/users/{userId}/account-deletion-reservations/{attemptId}`. Every response is
  private and uncacheable. Enable the caller after migration `0011` and the Organization endpoint
  are available. Keep a reservation-aware Organization rollback image once Identity can reserve
  attempts. Before
  restoring either service database, pause and drain the Identity deletion workers. Reconcile
  outstanding claims and reservations against the restored authority before resuming deletion.
- The directory tracks account status, member display and two-step verification. Its consumers
  retry on `DIRECTORY_REDELIVERY` (`application/models/directory/`): 1 s, 5 s, 30 s, 2 min, 10 min,
  30 min, then every hour, 32 deliveries, about 25 h 43 min before the dead letter. The same
  schedule protects the deletion event, which removes the account's memberships and emits
  `member.removed.v1`. The kit applies the schedule with `nak(delay)` and sets `max_deliver` to 32
  on each consumer at startup.
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

### Billing seat entitlement

`subscription.changed.v1` is consumed by `organization-service__project-seat-entitlement` on
`EVENTS` when `ORGANIZATION_SEAT_ENTITLEMENT_EVENTS_ENABLED=true`. The flag defaults to false
and can enable projection before quota enforcement. Deploy the exact consumer permissions and
reserve publication of `evt.subscription.changed.v1` for Billing before enabling the flag.
The published schema and the required `system` actor `billing-service` are validated before
opening the tenant transaction. The projector uses the full limits to validate a Free snapshot
and stores the plan, seat limit and version. The plan identifier remains extensible.

The durable starts from retained deliveries and resumes its position when restarted. The kit
commits its event-ID record with the projection in the same tenant transaction. The projection
independently fences duplicated, stale or conflicting snapshots under the seat admission lock.
A handler failure retries on 32 deliveries over about 25 hours and 43 minutes.
A malformed envelope goes straight to the dead-letter path. An operator may replay a valid
dead letter after resolving the delivery failure. A malformed envelope requires a correction
at the producer. Replaying retained messages covers the `EVENTS` retention window. Recovery
of an expired snapshot through the signed Billing entitlement endpoint is a separate rollout step.

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
- An address, given or derived, that the web application keeps as the first path segment of its
  own pages (the list of `Slug` in `openapi/public/organizations.yaml`) answers
  `422 organization.slug-reserved`. A patch that sends the current address back keeps it, even
  when it became reserved after it was chosen; no migration renames such an address.
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
- Both the organization and the sender allow at most 100 invitation emails in any 24 hours.
  Each newly invited address and each resend takes one from both budgets. A creation, batch or
  resend exceeding either allowance answers `429 invitation.daily-limit-reached` and writes,
  sends and emits nothing. Batches with no new invitations consume no units.
- An invitation batch may carry an `Idempotency-Key`, scoped to the organization of the token, the
  acting user and the operation: the same key from another user or in another organization runs a
  fresh batch. The actor's owner or admin role and the organization are checked before anything
  else, so a request whose authorization no longer holds answers as a fresh one would (`403`,
  `404`), never with the stored result. An equivalent batch (the same distinct addresses, without
  regard to case, in the same order, with the same role) replays the stored `200` body for 24 hours
  without sending, emitting or charging either allowance, to every retry, concurrent ones
  included; another batch answers `422 idempotency.key-reused`, also when it loses a race to
  commit the key; an equivalent batch still running with the key answers
  `409 idempotency.request-in-progress`, and only that. Only a `200` is recorded: a `429` or any
  other error leaves nothing, and the key runs again once it can succeed.
- `GET /internal/v1/invitations/{invitationId}` reads an invitation of the organization in any
  state, for the owner and the admins: `pending` or `expired` by its expiry while unanswered, then
  `accepted`, `refused` or `revoked` as stored. `answeredAt` is set for an acceptance or a refusal,
  `revokedAt` for a revocation, from `answered_at`, which holds the instant that closed it; a
  revocation keeps the row with its status, so the three are stored, never inferred. The actor's
  role and the invitation are read from one snapshot, and `pending` is told from `expired` at the
  `statement_timestamp()` of the read, never at the arrival of a request that may have waited for
  its connection. The answer is `Cache-Control: private,
no-store`, carries no `ETag` and is never conditional: an invitation becomes `expired` without
  a new `version`, so a tag derived from the version could validate a stale copy. The handler
  writes the body itself, so neither the kit's `EtagInterceptor` nor Express adds a tag or
  answers `304`.
- Received invitations use the current verified address from Identity. The local directory
  still tracks account existence and deletion. Acceptance and refusal check that the invitation
  still matches the address from Identity under the invitation lock. These routes require
  `IDENTITY_SERVICE_URL` and `ORGANIZATION_SERVICE_INTERNAL_TOKEN_PRIVATE_JWK`; Identity must trust
  the matching Organization issuer before rollout.
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
- `GET` and `QUERY /internal/v1/members` open a tenant `REPEATABLE READ READ ONLY` transaction for the
  permission check, the page, the filtered total and the counts by role.
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
  runner opened at REPEATABLE READ would break the check. Creation takes the sender budget lock
  when it sends mail. It needs no tenant budget lock because its new organization is private to
  the transaction. A request waiting on the lock longer
  than the `lock_timeout` of the application role (5 s) fails with a 500.
- `GET /internal/v1/invitations/{invitationId}` opens a tenant `REPEATABLE READ READ ONLY`
  transaction for the actor's membership and the invitation.
- A keyed invitation batch runs in the same tenant transaction. After the role and organization
  checks, it reads the committed live record of the key first, with the actor's active membership,
  in one statement and without any lock. With a record, it checks the actor's role from that same
  snapshot, then answers the stored body to an equivalent batch, taking neither allowance lock, and
  `422` to another: a member who lost the role answers `403` either way. Without a record, it takes a
  transaction-level advisory lock on the scoped key and the fingerprint of the batch with
  `pg_try_advisory_xact_lock`, never waiting, and reads the record again in either case, since a
  batch of the key may have committed in between: a refused claim answers `409` only while the key
  still has no record. A fresh batch runs as
  without a key and inserts its record last: the invitations, their ledger entries, their
  `invitation.issued.v1` outbox rows and the record commit together, and any failure rolls them all
  back. The primary key of `invitation_batch_replays` decides between two different batches of one
  key: the insert of the second waits for the first, stores nothing once it commits, and the second
  answers `422` and rolls back. The key lock is the first lock the batch takes, before the sender
  and organization locks, and an equivalent batch holding it never waits on the waiter, so it adds
  no deadlock to the order above.
- The purge job runs in system transactions, a bounded exception: each one `delete` of at most 500
  expired replay records, chosen by expiry and skipping the rows a batch is deleting.
- System transaction, the **bounded exceptions** of decision 9, each with explicit filters:
  - the creation of an organization: the organization does not exist before it and PostgreSQL
    assigns its id on insert, so no tenant transaction can hold it; it writes the rows of the new
    organization only (its owner, its invitations, its outbox rows, which the kit accepts in a
    system transaction) and reads the directory entry of the actor, held in share mode until it
    commits;
  - the list of the organizations of the actor: a read-only query filtered on `members.user_id`;
  - the invitations addressed to the actor: a read-only query filtered on the current verified
    address from Identity, provided the directory entry is active;
  - the first checks of an answer to an invitation: a read-only lookup of one invitation by id
    and of the actor's directory entry;
  - `GET /internal/v1/search-organizations`: a `REPEATABLE READ READ ONLY` export of at most 100
    active organization IDs per page up to the first snapshot's high-water UUID. Search and
    Identity use their own system actor and a token with a null organization;
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

- Idempotent invitation batches (`@cadenway/contracts` 0.45.0 and 0.46.0) use a table of this module rather
  than the kit's `@Idempotent()` interceptor and `idempotency_keys`: the interceptor scopes a key to
  the organization only and replays before the handler runs, while the contract scopes it to the
  acting user too and requires the current authorization before any replay. The in-progress marker
  is the transaction's advisory lock, not a committed row with a lease: it exists only while the
  batch's transaction does, so a request that fails without committing leaves nothing, a crashed
  process frees it when PostgreSQL closes its connection, and a stalled transaction holds it no
  longer than the `statement_timeout` (10 s) and `idle_in_transaction_session_timeout` (30 s) of
  `organization_app`. The lock covers the key and the fingerprint of the batch, so `409` means an
  equivalent request in flight only; a different batch runs, and the primary key of the table
  refuses it with `422` if the other commits the key first. A committed record is read before the
  lock, so retries of a committed batch never contend, and a refused claim reads the record again,
  so `409` never hides a `200` committed by then. The claim never waits: a retry that lands while
  the batch it repeats is still running answers the retryable `409` at once, and replays on its
  next attempt. A bounded wait (tried in an earlier revision) let the retries of one slow batch
  each hold one of the five pooled connections, starving the readiness probe and other tenants;
  pool safety wins over sparing a client a retryable `409`. A batch that waited on the allowance locks
  reads the record once more under them, before it plans or counts anything, so losing to another
  batch of its key that took the last send answers `422`, never `429`. The 24 hours start at the
  insert of the record and are read on the database's `clock_timestamp()`, not on the clock of a
  replica nor at the start of the request, so the time a batch waited on its locks never shortens
  them; the allowances keep the clock of the service. The live read finds one row by its primary
  key, where the volatile function costs nothing, while the purges compare with
  `statement_timestamp()`, which PostgreSQL can use as an index range bound
  (`tests/invitation-idempotency.int-spec.ts` checks both plans).
- The replay record keeps a fingerprint of the batch rather than its addresses, which only the
  replayed body still lists.
- A replay authorizes the actor from the snapshot of its record, read in one statement with the
  active membership and without a lock, while a fresh batch rechecks the role under a share lock on
  the membership before it plans anything. A replay creates no new effect: authorizing it against a
  snapshot that may predate a concurrent demotion by a moment only returns a result that already
  happened, while a blocking share lock let a stalled role change or removal (which holds the row
  exclusively) make every replay of that actor wait, each holding one of the five pooled
  connections, until the readiness probe and other tenants starved. Fresh batches create effects,
  so they keep the locked recheck.
- No admission limit bounds the replay records. A keyed batch whose addresses are all members or
  already invited sends no email, so the email allowance does not bound its record. Accepted
  because each record is bounded (at most 50 addresses per batch, the limit of the contract's
  `InvitationBatch`), the gateway throttles each session, and the purge drains more than 500 rows
  per tick on demand. A hard cap would need a new public error code, a contract change. Revisit
  with production figures: the `oldestExpiredAgeSeconds` the purge logs when it stops on its
  budget, and the size of `invitation_batch_replays`.
- Replay support is signalled by a route, not by a capability flag or a gateway switch: a keyed
  batch goes to `POST /internal/v1/invitation-batches`, which a release without replays does not
  serve, so a rolling deploy or a rollback can never run a keyed retry as a fresh batch (which
  would re-invite an address revoked meanwhile, send and charge again); the gateway turns that
  `404` into a retryable `503 upstream.unavailable`. The replay key holds no route: the advisory
  claim and the primary key of `invitation_batch_replays` are the organization, the actor, the
  digest of the key (and, for the claim, of the batch), so records written through the former
  route before the gateway moved keep replaying with no data migration.
- Reserved addresses (B19 of the webapp rebuild): a new code `organization.slug-reserved` rather
  than a reason on `organization.slug-invalid`, so that a client that only knows the latter never
  shows its length message for a reserved address. An address that becomes reserved after it was
  chosen is kept, and a patch may send it back unchanged; no migration renames it. Count such
  addresses in each environment before a release that reserves more.
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
- Each invitation permits one resend an hour. Invitation emails consume both the organization's
  and the sender's independent budgets of 100 in any 24 hours. Creation invitations, new
  invitations and resends count together. An invitation batch or a creation requiring more
  emails than remain is refused as a whole. No-op addresses and an organization created without
  invitations consume no units.
  - The sender budget is serialized first with a transaction advisory lock keyed by verified user
    ID, followed by the organization row lock. Issue and resend then recheck the sender's role
    under a share lock on the active membership before taking any invitation row lock. Read committed
    transactions count previous committed sends after obtaining each lock. The invitation,
    both ledger entries and the outbox record commit together.
  - Resend refusal order remains found, pending, the hour, then the allowance. The refusal
    reports the smaller remaining allowance. If both allowances have the same remaining
    balance, it reports the later time that one place becomes available in both. `Retry-After`
    is calculated when responding from the indicated time.
  - Revoking and reinviting uses a different invitation ID and still consumes the shared
    sender and organization budgets.
- Role changes and removals lock the actor and target memberships in member ID order before
  making authorization decisions. The same row supplies both roles when the actor is the target.
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
    account that takes it and the one that left it can both appear verified in the projection.
    Identity verifies one owner per address, and invitation reads and answers use that current
    proof. The directory allows the temporary duplicate so it can apply each account's events
    independently;
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
