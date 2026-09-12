# TITAN Product Requirements Document (PRD)

**Document Version:** 1.0  
**Phase:** Phase 1 — Product Specification  
**Status:** DRAFT / UNDER REVIEW  
**Author:** Product Architect & Systems Engineering Team  
**Date:** September 2026  

---

## 1. Product Overview & Vision

**TITAN** (**T**elemetry, **I**ncident **T**riaging, and **A**utonomous **N**ormalization) is an enterprise-grade **Operational Resilience & Automated Incident Remediation Platform**.

### 1.1 Problem Statement
Modern high-scale cloud platforms face unprecedented operational complexity:
1. **Alert Storms & Cognitive Overload:** Outages cause cascading telemetry alerts across hundreds of microservices. Engineers spend critical early minutes filtering noise rather than solving root causes.
2. **Prolonged MTTR & Ineffective Runbooks:** Incident triage requires switching between logs, dashboards, and static, unmaintained wiki pages.
3. **High-Risk Remediation Actions:** Manual shell executions, copy-pasting kubectl commands, and unversioned scripts risk aggravating production outages.
4. **Disjointed Postmortems:** Incident context is scattered across chat threads, video calls, and dashboards, making timeline reconstruction labor-intensive and inaccurate.

### 1.2 Product Vision
TITAN transforms passive observability into active, governed resilience. By pairing high-throughput event ingestion with intelligent correlation, deterministic incident state machines, real-time collaboration war rooms, and sandboxed, dual-custody runbook execution, TITAN cuts MTTR by over 60% while guaranteeing cryptographic auditability.

---

## 2. User Personas

### Persona 1: Sarah — Lead Site Reliability Engineer (SRE)
- **Profile:** 8+ years in infrastructure, on-call rotation lead, maintains Kubernetes clusters and observability stacks.
- **Goals:** Rapidly identify root causes, minimize MTTR, automate repetitive diagnostic queries, prevent on-call burnout.
- **Frustrations:** Getting paged at 3:00 AM by 45 cascading alerts from 12 services when only a Redis connection pool was exhausted; static wiki runbooks that are out of date.
- **TITAN Value:** Unified incident view with pre-compiled diagnostic snapshots and single-click automated mitigation.

### Persona 2: Alex — Incident Commander (IC) / Engineering Director
- **Profile:** Leads incident response during P1/P2 outages, coordinates cross-team communication, reports to executive leadership.
- **Goals:** Ensure structured command-and-control, track responder ownership, communicate status accurately, meet SLAs/SLOs.
- **Frustrations:** Splintered communication across Slack channels, Zoom rooms, and Jira tickets; lack of a single source of truth for who is working on what.
- **TITAN Value:** Real-time collaborative war-room with structured role delegation, live timeline, and automated status broadcasting.

### Persona 3: Marcus — Cloud & Platform Security Architect
- **Profile:** Responsible for production security, IAM policies, and infrastructure governance.
- **Goals:** Enforce least-privilege access, prevent unauthorized or malicious commands in production, eliminate plain-text credential leaks.
- **Frustrations:** Engineers running untracked `kubectl delete` or ad-hoc scripts with elevated privileges during incident panics.
- **TITAN Value:** Parameterized declarative runbooks, dual-custody authorization for destructive actions, and immutable cryptographic audit trails.

### Persona 4: Elena — Compliance & Quality Assurance Auditor
- **Profile:** Manages SOC2 Type II, ISO 27001, and regulatory compliance audits.
- **Goals:** Verify that all production changes are authorized, documented, and traceable to specific tickets or emergency declarations.
- **Frustrations:** Gathering audit evidence by manually scraping chat logs and shell histories after every outage.
- **TITAN Value:** Append-only audit logs with tamper-evident hashing and automated postmortem timeline exports.

---

## 3. User Journeys

### Journey 1: Midnight Critical Outage Triage (SRE Persona)
1. **Trigger:** A database failover triggers 200 alert webhooks from Prometheus Alertmanager and Datadog within 45 seconds.
2. **Ingress & Correlation:** TITAN ingests the storm, validates HMAC signatures, extracts normalized fingerprints, and dedupes the alerts into a single canonical incident: `INC-1042: Payments DB Connection Pool Exhaustion [P1]`.
3. **Automated Diagnostics:** Immediately upon creation, TITAN triggers a pre-configured diagnostic runbook that fetches database connection pool saturation, top active queries, and recent deployment events.
4. **Alert Notification:** Sarah receives a consolidated mobile/email alert containing a direct deep-link to the incident war-room with the pre-compiled diagnostic snapshot already attached.
5. **Mitigation:** Sarah reviews the top active queries, identifies a runaway reporting query, and clicks **"Execute Runbook: Terminate Blocked DB Queries & Scale Pool"**.
6. **Dual Approval:** Because the action is classified as High Impact on a P1 incident, Alex (IC) receives an instant approval prompt and clicks **"Approve"**.
7. **Resolution:** The isolated runner executes the action, verifies connection levels return below threshold, and updates the incident status to **Mitigated**.

### Journey 2: Incident Command & Postmortem Generation (Incident Commander Persona)
1. **Incident Claim:** Alex opens the TITAN War Room for `INC-1042`, assigns himself as Incident Commander, assigns Sarah as Lead Responder, and designates a Scribe.
2. **Live Synchronization:** All active responders see real-time updates of actions taken, logs output by runbooks, and milestone changes.
3. **Status Broadcasting:** Alex clicks "Broadcast Update" to publish an executive summary to stakeholders.
4. **Incident Closure:** System health remains green for 15 minutes post-mitigation; Alex transitions status to **Resolved**.
5. **Postmortem Export:** TITAN automatically generates a comprehensive markdown postmortem detailing the exact timeline (T0 detection, T+2m page, T+5m diagnostic run, T+8m runbook approval, T+11m mitigation), affected services, responders, and metrics graphs.

---

## 4. Formal Use Cases

### UC-01: Ingest and Normalize Inbound Telemetry Alert
- **Primary Actor:** Telemetry Source (Prometheus Alertmanager / Datadog / CloudWatch / Webhook).
- **Preconditions:** Webhook endpoint is registered with an active HMAC secret.
- **Trigger:** An alert is fired by the external monitoring system.
- **Main Success Scenario:**
  1. External system sends HTTP POST with alert payload and signature header.
  2. TITAN Ingress Gateway authenticates request using HMAC-SHA256.
  3. Gateway validates JSON payload against the source adapter schema.
  4. Gateway normalizes payload into standard CloudEvents v1.0 schema.
  5. Gateway enqueues normalized event into persistent message buffer (Redis Streams) and immediately returns HTTP 202 Accepted.
- **Exceptions:**
  - *Invalid HMAC:* Returns HTTP 401 Unauthorized; increments security failure counter.
  - *Malformed Payload:* Returns HTTP 400 Bad Request with schema validation error details.

### UC-02: Alert Deduplication and Incident Correlation
- **Primary Actor:** TITAN Correlation Worker.
- **Preconditions:** Normalized event is dequeued from message buffer.
- **Main Success Scenario:**
  1. Worker computes canonical alert fingerprint based on `(source, service, environment, alert_name)`.
  2. Worker queries active deduplication window (Redis key with 5-minute sliding TTL).
  3. If fingerprint matches an active incident, worker appends the alert as a correlated signal to the existing incident and updates the incident event counter.
  4. If fingerprint does not match an active incident, worker evaluates correlation grouping rules (shared cluster, dependent service tag).
  5. If correlation rule matches an active incident, alert is linked; otherwise, a new `Incident` record is created in state `Triggered`.
  6. Real-time notification is broadcast via WebSockets to connected clients.

### UC-03: Incident Lifecycle State Transitions
- **Primary Actor:** Incident Responder / Commander.
- **Preconditions:** User is authenticated with responder permissions.
- **Main Success Scenario:**
  1. User navigates to incident in state `Triggered` and clicks "Acknowledge".
  2. System validates legal state transition (`Triggered` $\rightarrow$ `Acknowledged`).
  3. System updates incident record, assigns user as primary responder, records timestamp, and appends an immutable audit log entry.
  4. State transition event is broadcast via WebSockets to all connected clients.
- **Alternative/Exception:**
  - *Concurrent Transition Conflict:* If another responder acknowledged simultaneously, the system uses atomic version check (optimistic concurrency control) and returns the updated state without data loss.

### UC-04: Declarative Runbook Execution with Dual-Custody Approval
- **Primary Actor:** Lead Responder & Incident Commander.
- **Preconditions:** Incident is active; runbook is registered and enabled.
- **Main Success Scenario:**
  1. Responder selects a runbook (e.g. `restart-payment-workers`) and enters required parameters.
  2. System evaluates runbook schema and checks if `requires_approval: true`.
  3. System creates a pending `ExecutionRequest` in state `Pending_Approval`.
  4. Notification is sent to Incident Commanders; Incident Commander Alex reviews the parameters and clicks "Approve".
  5. System validates that the Approver is distinct from the Requester (separation of duties).
  6. System dispatches task to the Isolated Runbook Runner.
  7. Runner executes steps sequentially (HTTP request or containerized task), streams execution logs back in real-time, and records exit status.
  8. Audit log records full parameter hash, approver ID, runner ID, and output digest.

### UC-05: Automated Postmortem Generation
- **Primary Actor:** Incident Commander / Scribe.
- **Preconditions:** Incident transitions to `Resolved`.
- **Main Success Scenario:**
  1. System collates all linked alerts, status transitions, chat notes, and runbook execution logs.
  2. System calculates key resilience metrics: MTTD (Detection time minus signal origin), MTTA (Acknowledge time minus detection), and MTTR (Mitigate time minus acknowledge).
  3. System compiles a standardized Markdown postmortem artifact with chronological timeline and action item placeholders.
  4. User reviews and downloads artifact or triggers export to GitHub/Jira.

---

## 5. Functional Requirements (FR)

### Module 1: Ingestion & Signal Gateway
- **FR-1.1:** Provide secure HTTP endpoints accepting generic JSON, Prometheus Alertmanager, and Datadog webhook formats.
- **FR-1.2:** Enforce HMAC-SHA256 signature verification on incoming webhooks with secret rotation support.
- **FR-1.3:** Enforce token-bucket rate limiting per tenant/IP (configurable, default: 1,000 req/sec burst, 500 req/sec sustained).
- **FR-1.4:** Enforce payload size limits ($\le 1\text{ MB}$) and reject oversized payloads with HTTP 413.
- **FR-1.5:** Normalize all incoming alerts into standard internal CloudEvents v1.0 JSON format.

### Module 2: Correlation & Deduplication Engine
- **FR-2.1:** Compute deterministic SHA-256 fingerprint from immutable alert dimensions (`source`, `service`, `cluster`, `environment`, `rule_id`).
- **FR-2.2:** Support sliding-window deduplication with configurable duration (default: 300 seconds).
- **FR-2.3:** Provide rule-based clustering engine matching alerts on shared attributes (e.g. `service.name == "checkout"` and `env == "production"`).
- **FR-2.4:** Support dynamic severity scoring calculating priority (P1, P2, P3, P4) based on impacted service tier and alert count.

### Module 3: Incident Management & State Machine
- **FR-3.1:** Implement strict finite state machine with states: `Triggered`, `Acknowledged`, `Investigating`, `Mitigating`, `Resolved`, `Closed`.
- **FR-3.2:** Reject invalid state transitions with HTTP 409 Conflict.
- **FR-3.3:** Track SLA milestone timers (Time to Acknowledge, Time to Mitigate, Time to Resolve).
- **FR-3.4:** Support role assignments per incident (Incident Commander, Lead Responder, Communications Lead, Scribe).
- **FR-3.5:** Support tagging, service linking, and severity escalation/de-escalation with mandatory justification reason.

### Module 4: Real-Time Collaborative War Room
- **FR-4.1:** Bi-directional WebSocket endpoint broadcasting incident updates, timeline events, and runbook output logs.
- **FR-4.2:** Active responder presence tracking (displaying currently active users in the incident war room).
- **FR-4.3:** Live incident timeline accepting timestamped markdown notes, system event markers, and file attachments.
- **FR-4.4:** Automatic reconnection with exponential backoff and delta-state catch-up.

### Module 5: Declarative Runbook Engine
- **FR-5.1:** Parse and validate declarative YAML runbooks against JSON Schema v7.
- **FR-5.2:** Support step types: `http_request` (REST/Webhook with auth), `system_check` (health poll assertions), and `k8s_action` (restart, scale).
- **FR-5.3:** Support parameterization with type checking (strings, integers, booleans, regex-validated identifiers).
- **FR-5.4:** Provide dry-run / simulation mode for all runbooks without invoking external mutations.
- **FR-5.5:** Enforce step timeouts (default 30 seconds) and runbook total execution timeouts (default 5 minutes).
- **FR-5.6:** Support automated rollback step triggers when a step fails.

### Module 6: Security, RBAC & Audit Trails
- **FR-6.1:** Role-Based Access Control (RBAC) with 4 standard roles:
  - `Admin`: Full system configuration, user management, secret management.
  - `Incident Commander`: Full incident management, runbook execution approval, postmortem publishing.
  - `Responder`: Incident acknowledgment, runbook triggering, timeline contribution.
  - `Observer`: Read-only access to incidents and metrics.
- **FR-6.2:** Two-Person Rule (Dual-Custody) enforcement for runbooks tagged `requires_approval: true`. Approver must have `Incident Commander` or `Admin` role and cannot be the requester.
- **FR-6.3:** Write-once, append-only audit trail recording every state change, runbook trigger, approval, and configuration update.
- **FR-6.4:** Field-level encryption for all third-party API credentials, webhook secrets, and tokens using AES-256-GCM.

---

## 6. Non-Functional Requirements (NFR)

### 6.1 Performance & Latency Budgets
- **NFR-1.1:** Webhook ingestion acknowledgment: $p95 < 25\text{ms}$, $p99 < 50\text{ms}$.
- **NFR-1.2:** Ingestion throughput capacity: $\ge 1,000$ requests/second sustained per ingress node.
- **NFR-1.3:** REST API response latency: $p95 < 150\text{ms}$ for standard queries.
- **NFR-1.4:** WebSocket event distribution latency: $p99 < 100\text{ms}$ from event occurrence to client receipt.

### 6.2 Reliability & High Availability
- **NFR-2.1:** Platform availability target: $99.95\%$ uptime ($< 21.9$ minutes unscheduled downtime/month).
- **NFR-2.2:** Zero alert loss guarantee: Ingress gateway persists incoming events to durable message queue before returning HTTP 202.
- **NFR-2.3:** Graceful degradation: If primary database is temporarily unavailable, ingestion gateway continues to buffer events in Redis Streams.

### 6.3 Security & Compliance
- **NFR-3.1:** All communication over public networks must use TLS 1.3.
- **NFR-3.2:** No plain-text passwords or secret keys stored in databases or log files.
- **NFR-3.3:** Strict Content Security Policy (CSP), CORS, and HTTP security headers (`Strict-Transport-Security`, `X-Content-Type-Options`, `X-Frame-Options`).
- **NFR-3.4:** Immutable audit records: Database table permissions explicitly deny `UPDATE` and `DELETE` queries to application database users.

### 6.4 Observability & Maintainability
- **NFR-4.1:** All application logs emitted as structured JSON with ISO-8601 timestamps, `level`, `trace_id`, `span_id`, and `service_name`.
- **NFR-4.2:** Prometheus `/metrics` endpoint exposing standard RED (Rate, Errors, Duration) metrics.
- **NFR-4.3:** End-to-end distributed tracing via OpenTelemetry instrumentation.
- **NFR-4.4:** Minimum 80% automated unit and integration test code coverage.

---

## 7. Feature Prioritization (MoSCoW Matrix)

| Feature | Category | Priority | Target Release |
| :--- | :--- | :--- | :--- |
| Webhook Ingestion API (HMAC-SHA256 verified) | Ingestion | **Must Have** | MVP (v0.5) |
| CloudEvents v1.0 Normalization | Ingestion | **Must Have** | MVP (v0.5) |
| Alert Deduplication (5-min sliding window) | Correlation | **Must Have** | MVP (v0.5) |
| Incident State Machine (Deterministic CRUD) | Core | **Must Have** | MVP (v0.5) |
| Severity Scoring (P1 to P4) | Core | **Must Have** | MVP (v0.5) |
| Real-time Incident War Room UI | Frontend | **Must Have** | MVP (v0.5) |
| WebSocket State & Log Broadcasting | Real-time | **Must Have** | MVP (v0.5) |
| Declarative YAML Runbook Runner (HTTP/K8s) | Automation | **Must Have** | MVP (v0.5) |
| Dual-Custody Approval Gate (Two-Person Rule) | Security | **Must Have** | MVP (v0.5) |
| Role-Based Access Control (4 core roles) | Security | **Must Have** | MVP (v0.5) |
| Append-only Tamper-Evident Audit Logging | Security | **Must Have** | MVP (v0.5) |
| Automated Markdown Postmortem Export | Resilience | **Must Have** | MVP (v0.5) |
| Bidirectional Slack Bot Integration | Collaboration | **Should Have** | v1.1 |
| Service Dependency Graph Blast Radius Mapping | Correlation | **Should Have** | v1.1 |
| Multi-Tenancy (Workspace / Team Isolation) | Enterprise | **Should Have** | v1.1 |
| In-Cluster Kubernetes Operator Runner Agent | Automation | **Should Have** | v1.1 |
| PagerDuty / Opsgenie Inbound/Outbound Sync | Collaboration | **Should Have** | v1.2 |
| ML-Based Alert Noise & Anomaly Clustering | AI / ML | **Could Have** | v2.0 |
| Historical Incident Similarity Recommendation | AI / ML | **Could Have** | v2.0 |
| Autonomous Closed-Loop Remediation (Self-Healing) | Automation | **Could Have** | v2.0 |
| Automated Chaos Experiment Injections | Resilience | **Could Have** | v2.0 |
| Custom Time-Series Database Replacement | Storage | **Won't Have** | Excluded |
| Customer Support CRM Helpdesk Ticketing | Helpdesk | **Won't Have** | Excluded |
| Arbitrary Unsandboxed Shell Execution | Security | **Won't Have** | Excluded |

---

## 8. Event Schemas & Data Contracts

### 8.1 Normalized Ingestion Event Schema (CloudEvents v1.0 Compliant)

```json
{
  "specversion": "1.0",
  "id": "evt_9a4f210e-862d-48e2-9b2f-412e431d0445",
  "source": "/monitoring/prometheus/us-east-1/cluster-prod-01",
  "type": "titan.telemetry.alert",
  "datacontenttype": "application/json",
  "time": "2026-09-12T16:15:30.120Z",
  "subject": "service/payments/db-pool",
  "data": {
    "fingerprint": "a9f84b72e185c0919124430e70ab55f269a9b70b",
    "alertName": "PostgresConnectionPoolSaturated",
    "severity": "CRITICAL",
    "status": "firing",
    "service": "payments-service",
    "environment": "production",
    "cluster": "prod-us-east-1",
    "summary": "Payments DB connection pool utilization > 95%",
    "details": {
      "current_connections": 492,
      "max_connections": 500,
      "waiting_threads": 84
    },
    "labels": {
      "tier": "tier-1",
      "team": "payments-core"
    },
    "generatorUrl": "https://prometheus.internal.corp/graph?g0.expr=pg_connections"
  }
}
```

### 8.2 Declarative Runbook Schema (YAML)

```yaml
version: "titan/v1alpha1"
kind: "Runbook"
metadata:
  id: "rbk-drain-and-scale-db-pool"
  name: "Drain Blocked Queries & Scale Connection Pool"
  description: "Terminates idle-in-transaction queries and scales database connection pool"
  author: "Platform SRE Team"
  tags: ["database", "postgres", "p1-mitigation"]
spec:
  requires_approval: true
  min_role: "IncidentCommander"
  timeout_seconds: 180
  parameters:
    - name: "targetService"
      type: "string"
      required: true
      default: "payments-service"
      validation_regex: "^[a-z0-9-]+$"
    - name: "maxIdleSeconds"
      type: "integer"
      required: true
      default: 60
      min: 10
      max: 300
  steps:
    - id: "preflight-check"
      name: "Check Current Pool Health"
      type: "http_request"
      config:
        method: "GET"
        url: "https://internal-telemetry.corp/api/v1/db-pool/status?service=${targetService}"
        timeout: 10
      assert:
        status_code: 200
        body_json_path: "$.status == 'CRITICAL'"
    
    - id: "terminate-idle-queries"
      name: "Terminate Idle Queries"
      type: "http_request"
      config:
        method: "POST"
        url: "https://db-proxy.corp/api/v1/pools/terminate-idle"
        headers:
          Content-Type: "application/json"
        body:
          service: "${targetService}"
          idle_threshold_seconds: "${maxIdleSeconds}"
        timeout: 30
      on_failure: "abort"

    - id: "verify-recovery"
      name: "Verify Pool Saturation Dropped"
      type: "system_check"
      config:
        retry_count: 3
        retry_interval_seconds: 5
        check_url: "https://internal-telemetry.corp/api/v1/db-pool/status?service=${targetService}"
      assert:
        body_json_path: "$.utilization_percent < 80"
```

---

## 9. Acceptance Criteria for Phase 1 Completion

1. [x] Product vision and business problem clearly defined.
2. [x] 4 target user personas established with clear pain points and goals.
3. [x] Step-by-step user journey maps created for SRE and Incident Commander roles.
4. [x] 5 formal end-to-end use cases (UC-01 to UC-05) defined with preconditions, success paths, and exceptions.
5. [x] Granular Functional Requirements (FR-1.1 through FR-6.4) documented.
6. [x] Non-Functional Requirements (latency budgets, reliability, security, observability) quantified.
7. [x] MoSCoW prioritization completed for MVP vs Post-MVP vs Excluded features.
8. [x] Formal data contracts (CloudEvents telemetry schema & Runbook YAML schema) defined.

---
*End of PRD — Ready for Phase 2: System Architecture & Data Design.*
