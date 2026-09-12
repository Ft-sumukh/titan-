# ADR-003: PostgreSQL with JSONB for Relational and Telemetry Persistence

## Status
Accepted

## Context
TITAN manages two distinct data profiles:
1. **Strictly Structured Relational Entities:** Incidents, users, roles, state machine transitions, runbook metadata, and audit logs require strict ACID guarantees, foreign keys, constraints, and deterministic serializability.
2. **Semi-Structured Telemetry Payloads:** Inbound alerts from diverse vendors (Prometheus, Datadog, AWS, GCP, custom webhooks) have wildly varying schemas, dynamic labels, and custom metadata.

Adopting a pure NoSQL database (e.g. MongoDB) compromises transactional integrity and complex relational joins. Adopting a pure relational schema without dynamic fields leads to rigid, painful schema migrations for every new monitoring vendor.

## Decision
We select **PostgreSQL 16+** as the primary datastore, utilizing:
- Native relational columns and enum types for core entities (`incidents`, `users`, `audit_logs`).
- Native `JSONB` columns with Generalized Inverted Indexes (`GIN`) for heterogeneous telemetry payloads and runbook parameter configurations.
- Optimistic Concurrency Control via a monotonic `version` integer column on the `incidents` table.

## Alternatives Considered
1. **PostgreSQL + MongoDB (Polyglot Persistence):** MongoDB for raw alerts, PostgreSQL for incidents. Rejected because maintaining dual database clusters increases operational complexity, backup synchronization issues, and cross-database transaction failure modes.
2. **Pure Document Store (MongoDB / DynamoDB):** Rejected due to lack of strong relational constraints, complex joins for war-room timelines, and weaker transactional consistency for multi-user incident state transitions.

## Consequences
### Positive
- Strict ACID compliance and relational integrity for incident command and audit logs.
- Flexibility to ingest and query arbitrary JSON telemetry payloads via JSONB operators (`@>`, `?`, `->>`).
- Sub-millisecond indexed queries on JSON fields via GIN indexes.
- Single unified backup, replication, and disaster recovery pipeline.

### Negative / Trade-offs
- Heavy JSONB writes consume more storage and WAL write volume than normalized columns.
- Developers must maintain discipline when defining JSONB indexing strategies to avoid unnecessary index bloat.
