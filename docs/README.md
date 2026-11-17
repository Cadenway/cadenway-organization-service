# cadenway-organization-service documentation

Planned role: cadenway-organization-service owns organizations and who belongs to them. NestJS, its own PostgreSQL database (one database with a migrator role and an application role in the shared PostgreSQL of the VPS), events over NATS JetStream through `@cadenway/nest-messaging`, internal REST for the API gateway. Local port 3011.

## Current status

The NestJS application under `src/` runs on `@cadenway/nest-common` and `@cadenway/nest-messaging`: configuration validated at start-up, JSON logs, OpenTelemetry preloaded, the internal token required on every route but the health probes, the NATS connection of the `organization` user with the outbox relay, and a readiness route that checks PostgreSQL and NATS. The migrations create the tables of the service kit (outbox, processed ids, versions, `Idempotency-Key`), owned by the platform module, and those of the organizations module: organizations, members, invitations and the user directory projected from the events of identity-service, with the internal routes of `openapi/internal/organization-service.yaml` and the events of `asyncapi/organization-service.yaml` (P2b of the plan). The later capabilities follow the target architecture in this guide.

## Read the guides

- [Architecture and ownership](architecture.md): boundaries and planned repository structure.
- [Development and checks](development.md): prerequisites, planned commands and verification.
- [Domain and integration](integration.md): repository-specific contracts, behavior and dependencies.

## Sources and policy

- [Repository overview](../.github/README.md) and [contribution guide](../.github/CONTRIBUTING.md).
- [Repository instructions and hard limits](../AGENTS.md).
- [Claude Code instructions](../CLAUDE.md) and [tooling](../.claude/README.md).
- [Codex tooling](../.codex/README.md).
- [Interactive mockup](https://claude.ai/artifact/KYRM7AnsYLiBLBLKy8i4HE), [integration guide](https://claude.ai/artifact/CpJHVCiFfF9j3KbHQ2S1Et), and [repositories and packages](https://claude.ai/artifact/BPinmYxoF3mbK8w9BMB43N).

Repository instructions take precedence over this summary. Refer to the actual package manifests, implementation, specifications, and workflows once they exist; do not infer a deployed feature from a target design.
