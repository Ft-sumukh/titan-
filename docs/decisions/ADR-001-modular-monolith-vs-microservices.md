# ADR-001: Modular Monolith vs Microservices for Core Application

## Status
Accepted

## Context
TITAN requires high cohesion between alert correlation, incident state management, runbook scheduling, and real-time collaboration. Building a distributed microservice mesh at the beginning of greenfield development introduces operational overhead, network latency, distributed transaction complexity (sagas), complex local development setup, and deployment synchronization challenges. Conversely, a monolithic architecture without boundaries risks turning into a "big ball of mud."

## Decision
We adopt a **Modular Monolith architecture** with strict Clean Architecture / Hexagonal layer boundaries for TITAN's core application layer.
- Sub-domains (`ingestion`, `correlation`, `incidents`, `runbooks`, `audit`, `notifications`) are encapsulated into discrete modules within a shared codebase.
- Inter-module communication occurs via defined in-memory interfaces and strongly-typed domain events, never through direct database coupling.
- High-throughput ingress and the isolated runbook execution runner are decoupled into discrete standalone services connected via Redis Streams and signed RPC, ensuring operational isolation where truly needed.

## Alternatives Considered
1. **Fully Distributed Microservices:** Prematurely separated into 6+ distinct microservices with gRPC. Rejected due to excessive network overhead, distributed tracing complexity, and slowed development velocity.
2. **Traditional Monolith:** All components sharing database queries and ad-hoc function calls. Rejected because it prevents future scaling and blurs security boundaries.

## Consequences
### Positive
- Single unified build, test, and deployment pipeline for core services.
- Zero network serialization overhead for inter-domain business calls.
- Simplified local development (`docker compose up` with minimal containers).
- Clean boundary contracts enable extracting any module into a separate microservice in the future with zero domain logic rewrites.

### Negative / Trade-offs
- Must enforce strict linting / architectural rules (e.g. dependency-cruiser) to prevent accidental direct imports across module boundaries.
- All core modules share the same runtime process and memory space in the monolith deployment.
