# Architecture and ownership

[Documentation index](README.md) · [Repository instructions](../AGENTS.md)

## Status

At the time this documentation was written, this checkout has no `package.json`, application source tree, or GitHub workflow files. The target architecture, scripts, and workflows in this guide must be created and verified during bootstrap.

The following architecture is the target recorded in [AGENTS.md](../AGENTS.md). Paths and integrations are design boundaries, not evidence that files or services already exist.

## Purpose and target structure

waypoint-organization-service owns organizations and who belongs to them. NestJS, its own PostgreSQL database (one database and one user in the shared PostgreSQL of the VPS), events over NATS JetStream through `@waypoint/nest-messaging`, internal REST for the API gateway. Local port 3011.

|            |                                                                                                                                                                           |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Data       | Organizations (name, address slug, logo, language), members and roles, invitations and invite link, guests, verified domains, security policies, the audit log (90 days). |
| API        | Organizations, members, roles, invitations, domains, ownership transfer, deletion, audit log and CSV export.                                                              |
| Emits      | `organization.created`, `organization.deleted`, `member.invited`, `member.joined`, `member.role-changed`, `member.removed`, `domain.verified`                             |
| Listens to | events relevant to the audit log, `subscription.changed` (updates seat count)                                                                                             |
| External   | DNS lookups for domain verification (TXT record).                                                                                                                         |
| Phase      | Extracted later, when needed                                                                                                                                              |

Starts as a module of waypoint-identity-service; this repository receives it when the extraction is decided.

## Architectural ownership

- Business code lives in modules under `src/modules/<module>/`, each with `domain/`, `application/`, `infrastructure/`, `api/` and a `MODULE.md`.
- Cross-cutting plumbing (config, logging, tracing, errors, auth guards, messaging) comes from the waypoint-service-kit packages (`@waypoint/nest-common`, `@waypoint/nest-messaging`, `@waypoint/nest-testing`), never re-implemented here.
- The domain is pure; use cases own transactions; controllers and handlers translate.
- Rendering of anything user-facing belongs to the webapp; this service returns data and stable error codes.

## Boundaries

- No access to another service's database or internal code; cross-service needs use `@waypoint/contracts` routes or events.
- NATS only through `@waypoint/nest-messaging`; config, logs, errors, health and auth guards through `@waypoint/nest-common`.
- Routes and event payloads come from the installed `@waypoint/contracts`; never redefine them locally.
- The service is internal: no Traefik label, no public route; the API gateway is its only HTTP caller.
- No sibling sources imported, no `file:` or `link:` dependency on a sibling.

## Cross-repository changes

Each checkout owns its implementation and release. Use published `@waypoint/*` packages instead of sibling source imports or local dependency links. For contract changes, make the contract and generated package available first, then update the producing service, gateways and listeners, and finally the webapp. Each step should remain deployable independently.
