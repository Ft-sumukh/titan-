# TITAN Technology Selection & Stack Evaluation

**Document Version:** 1.0  
**Phase:** Phase 3 — Technology Selection  
**Status:** DRAFT / UNDER REVIEW  
**Author:** Software Architect & DevOps Lead  
**Date:** September 2026  

---

## 1. Evaluation Methodology

Every technology selection for Project TITAN is evaluated strictly against our core engineering principles and quantified requirements:
1. **Performance & Low-Latency:** Must comfortably satisfy $p99 < 50\text{ms}$ webhook acknowledgment and $p99 < 100\text{ms}$ WebSocket event broadcast.
2. **Type Safety & Reliability:** Unified static typing across the entire pipeline to eliminate runtime type mismatches.
3. **Operational Simplicity & Maintainability:** Avoiding premature operational burden while ensuring zero architectural dead-ends.
4. **Security & Zero-Trust Posture:** Strong isolation primitives, cryptographic libraries, and least-privilege deployment models.

---

## 2. Technology Evaluation Matrices

### 2.1 Backend Framework & Runtime
- **Selected Technology:** **Node.js 22 LTS with Fastify & TypeScript**
- **Reason:** Fastify is one of the highest-throughput web frameworks in the Node.js ecosystem (achieving $60{,}000+$ req/sec with low memory footprint and built-in JSON Schema validation via Ajv). TypeScript provides end-to-end type safety shared with domain models and frontend clients. Native async I/O handles thousands of concurrent webhook connections with negligible overhead.
- **Alternatives Considered:**
  - *Go (Gin / Chi):* Exceptional performance and concurrency, but introduces language bifurcation between backend (Go) and frontend (TypeScript), slowing early development velocity and preventing shared DTO contracts.
  - *Python (FastAPI):* Excellent for AI/ML, but significantly lower raw webhook throughput and higher memory footprint under concurrent event storms.
  - *Express.js:* Familiar, but legacy architecture, slow JSON serialization, lacking native schema validation, and poor async error propagation.
- **Trade-offs:** CPU-intensive tasks (e.g. heavy crypto operations or bulk compression) must be offloaded to worker threads or native bindings to avoid blocking the event loop.

---

### 2.2 Frontend Framework & UI Stack
- **Selected Technology:** **Next.js 15 (App Router) + React 19 + TypeScript + Tailwind CSS + Shadcn UI + TanStack Query + Zustand**
- **Reason:** Modern incident war-rooms require reactive, high-density data visualizations, live WebSocket streams, and snappy local state management. React 19 + Next.js App Router provides Server-Side Rendering (SSR) for initial dashboard load and SEO/auth gates, while TanStack Query and Zustand provide robust client-side caching, optimistic updates, and connection state management. Shadcn UI / Tailwind CSS delivers an accessible, accessible, production-grade design system without heavy runtime CSS-in-JS overhead.
- **Alternatives Considered:**
  - *Vite + Pure React SPA:* Simpler build pipeline, but lacks built-in server routes for SSR and edge auth checks.
  - *Vue.js 3 / Nuxt:* Excellent reactivity, but smaller ecosystem for enterprise-grade data grids, terminal emulators, and incident timeline components.
  - *Angular:* Heavy framework overhead with rigid boilerplate that slows rapid iteration.
- **Trade-offs:** Next.js App Router has a learning curve for server vs client boundary separation, requiring disciplined component architecture.

---

### 2.3 Primary Database
- **Selected Technology:** **PostgreSQL 16+ (with pgcrypto, uuid-ossp, and JSONB)**
- **Reason:** PostgreSQL provides industry-standard ACID compliance, row-level locking, foreign keys, and serializable transactions for incident states, combined with native `JSONB` and GIN indexing for heterogeneous telemetry payloads from Prometheus, Datadog, and AWS. It eliminates polyglot database complexity while delivering sub-millisecond query performance.
- **Alternatives Considered:**
  - *MongoDB:* Natural for document storage, but weak relational integrity, complex multi-document transaction handling, and inadequate guarantees for strict state machine transitions and financial/compliance audit trails.
  - *MySQL 8:* Mature relational database, but inferior JSONB indexing and query expression capabilities compared to PostgreSQL.
- **Trade-offs:** High-volume JSON writes generate more WAL traffic than pure normalized columns, requiring tuning of vacuuming and connection pooling (PgBouncer).

---

### 2.4 Cache & Session Store
- **Selected Technology:** **Redis 7.2 (with AOF Persistence)**
- **Reason:** Sub-millisecond in-memory key-value store for session caching, token revocation blocklists, sliding-window deduplication locks (`SETNX`), and token-bucket rate limiting.
- **Alternatives Considered:**
  - *Memcached:* Fast, but lacks data structures (sets, hashes), persistence, and pub/sub capabilities.
  - *Dragonfly / KeyDB:* Multi-threaded Redis drop-ins, but Redis 7.2 is far more mature, universally supported by cloud providers, and battle-tested.
- **Trade-offs:** Memory-bound storage requiring explicit eviction policies and memory monitoring.

---

### 2.5 Message Queue & Asynchronous Streaming
- **Selected Technology:** **Redis Streams**
- **Reason:** Built into Redis 7+, Redis Streams provides persistent, consumer-group-based append-only streaming with message acknowledgment (`XACK`) and pending entries lists (`XPENDING`). It handles $> 50{,}000$ events/sec with zero additional infrastructure dependencies.
- **Alternatives Considered:**
  - *Apache Kafka:* Outstanding distributed log, but massive operational complexity (KRaft/ZooKeeper, JVM overhead) unjustified for greenfield MVP.
  - *RabbitMQ:* Feature-rich AMQP broker, but adds an extra infrastructure dependency alongside Redis.
  - *AWS SQS / GCP PubSub:* Managed cloud queues, but introduces cloud provider lock-in and prevents seamless single-command local development.
- **Trade-offs:** Streams must be capped (`MAXLEN`) to avoid unbounded memory consumption over time.

---

### 2.6 Real-Time Communication Protocol
- **Selected Technology:** **WebSockets (`ws` library on Fastify + native browser WebSocket client)**
- **Reason:** Incident war-rooms require bi-directional, sub-100ms real-time communication for live timeline feeds, responder presence indicators, and live runbook execution log streaming.
- **Alternatives Considered:**
  - *Server-Sent Events (SSE):* Simpler HTTP-based streaming, but unidirectional (client cannot send heartbeats or typing indicators over the same connection).
  - *HTTP Long Polling:* Extremely inefficient under high concurrency; saturates server sockets and adds significant latency.
  - *gRPC-Web:* High performance, but requires an Envoy proxy translation layer in browser environments, increasing architectural complexity.
- **Trade-offs:** Requires connection state management, heartbeat pings, and reconnection backoff logic on client disconnects.

---

### 2.7 Authentication & Authorization System
- **Selected Technology:** **JWT (RS256 Asymmetric Tokens) + HTTP-Only Secure Cookies + RBAC Engine**
- **Reason:** RS256 asymmetric signing allows any internal service to verify tokens with a public key without querying the database or central auth server. Short-lived Access Tokens (15 min) paired with rotatable Refresh Tokens stored in HTTP-Only, SameSite=Strict cookies protect against XSS and CSRF attacks.
- **Alternatives Considered:**
  - *Opaque Database Sessions:* High security, but requires a database or Redis lookup on every single API request.
  - *Third-Party SaaS Auth (Auth0 / Clerk):* High convenience, but creates external vendor dependency, recurring cost, and prevents air-gapped or private enterprise installations.
- **Trade-offs:** Requires key pair rotation management and a Redis-backed token revocation list for immediate session termination.

---

### 2.8 Object & File Storage
- **Selected Technology:** **S3-Compatible Object Storage (MinIO for Local Dev / AWS S3 for Production)**
- **Reason:** Incident postmortems, diagnostic core dumps, log archives, and timeline attachments should never bloat the primary relational database. S3 API compatibility ensures identical code runs locally via MinIO and in production on AWS S3, GCP Cloud Storage, or Azure Blob.
- **Alternatives Considered:**
  - *Local Filesystem Storage:* Incompatible with horizontally scaled multi-pod deployments.
  - *Database BLOBs:* Severely degrades database performance, backup times, and replication efficiency.
- **Trade-offs:** Requires presigned URL generation and lifecycle cleanup policies for temporary diagnostic archives.

---

### 2.9 Search & Telemetry Indexing
- **Selected Technology:** **PostgreSQL Full-Text Search (tsvector / GIN) for MVP; OpenSearch / Elasticsearch for Phase 8**
- **Reason:** PostgreSQL native `tsvector` and `pg_trgm` extensions provide fast, ranked full-text search across incident titles, summaries, and timeline notes without introducing a dedicated search cluster for MVP.
- **Alternatives Considered:**
  - *Elasticsearch / OpenSearch:* Powerful distributed search, but adds significant JVM memory requirements ($2\text{ GB}+$ RAM) and operational management to local development and early staging.
- **Trade-offs:** Full-text search in PostgreSQL scales to hundreds of thousands of incidents, but beyond millions of records, an external search index will be required.

---

### 2.10 Containerization & Local Development
- **Selected Technology:** **Docker & Docker Compose**
- **Reason:** Reproducible, isolated, single-command environment bootstrapping (`docker compose up`) that runs Gateway, API, Redis, PostgreSQL, and Web console identically on any developer machine or CI runner.
- **Alternatives Considered:**
  - *Local Native Installation:* Fragile "works on my machine" issues across operating systems (Windows, macOS, Linux).
  - *Minikube / Kind:* Heavyweight for daily feature development; slower startup and debugging loop.
- **Trade-offs:** Docker Desktop overhead on local developer laptops.

---

### 2.11 CI/CD & Automated Testing
- **Selected Technology:** **GitHub Actions + Vitest (Unit/Integration) + Playwright (E2E)**
- **Reason:** Native integration with GitHub repository (`https://github.com/Ft-sumukh/titan-.git`). Vitest provides blistering-fast, ESM-native unit and integration testing sharing TypeScript configurations. Playwright provides reliable, cross-browser end-to-end testing for real-time war-room interactions.
- **Alternatives Considered:**
  - *Jest:* Standard, but slower than Vitest on modern ESM/TypeScript codebases.
  - *Cypress:* Capable, but heavier resource usage and slower multi-tab/WebSocket test execution compared to Playwright.
- **Trade-offs:** CI runners require Docker services for database integration tests.

---

### 2.12 Observability & Telemetry Instrumentation
- **Selected Technology:** **OpenTelemetry SDK + Prometheus (`prom-client`) + Pino Structured Logger**
- **Reason:** Pino is the fastest JSON logger in Node.js, producing zero noticeable overhead. OpenTelemetry is the vendor-neutral cloud standard for distributed tracing. Prometheus client exposes standard RED metrics on `/metrics`.
- **Alternatives Considered:**
  - *Winston:* Popular, but significantly slower and higher allocation overhead than Pino.
  - *Vendor SDKs (Datadog / New Relic agent):* Proprietary lock-in.
- **Trade-offs:** Requires standardized trace context propagation across HTTP headers (`traceparent`).

---

## 3. Technology Stack Summary Table

| Layer | Primary Technology | Purpose / Role |
| :--- | :--- | :--- |
| **Language** | TypeScript 5.5+ | End-to-end static type safety |
| **Ingress & API** | Node.js 22 LTS + Fastify 5 | High-throughput HTTP & WebSocket Gateway |
| **Frontend** | Next.js 15 + React 19 + Tailwind | Incident war room & reactive dashboard |
| **State & Cache** | Redis 7.2 (Streams + Cache) | Ingestion buffer, dedupe locks, rate limiting |
| **Relational DB** | PostgreSQL 16+ (JSONB + GIN) | Incidents, alerts, users, audit trails |
| **Object Store** | MinIO (Dev) / AWS S3 (Prod) | Diagnostics, dumps, postmortem artifacts |
| **Security / Auth** | RS256 JWT + AES-256-GCM | Token auth, credential vault encryption |
| **Testing** | Vitest + Playwright | Unit, integration, and E2E test suites |
| **Observability** | OpenTelemetry + Pino + Prom | Tracing, structured logs, and metrics |
| **Orchestration** | Docker Compose / K8s Helm | Local environment & cloud deployments |

---
*End of Technology Selection Specification — Ready for Phase 4: Repository Foundation.*
