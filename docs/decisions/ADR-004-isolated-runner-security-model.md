# ADR-004: Isolated Runbook Execution Runner Security Model

## Status
Accepted

## Context
Automated and human-triggered remediation runbooks interact directly with production infrastructure (issuing HTTP requests to internal microservices, invoking Kubernetes cluster APIs, and scaling workloads). If the execution environment is co-located with the central control plane, a vulnerability (e.g. command injection, server-side request forgery, or malicious payload manipulation) could compromise the entire TITAN platform, including database credentials and audit logs.

## Decision
We decouple the **Runbook Execution Runner** into an isolated execution agent with a zero-trust security perimeter:
1. **Network & Privilege Isolation:** The runner runs in a detached network namespace or container with egress strictly restricted to authorized target endpoints.
2. **Zero Database Access:** The runner possesses zero database credentials and cannot read or write to PostgreSQL.
3. **Signed Task Payloads:** The control plane issues cryptographically signed execution jobs containing strictly validated parameters. The runner verifies the control plane's signature before starting work.
4. **Structured Invocation Over Arbitrary Shells:** In the MVP, execution steps are constrained to structured HTTP webhooks, Kubernetes REST API patches, and pre-registered safe script templates. Arbitrary user-supplied shell script strings (`eval`, `sh -c`) are strictly forbidden.
5. **Dual-Custody Enforcement:** Critical or destructive tasks require signed authorization tokens from two distinct users (Requester + Approver) before the task is dispatched to the runner.

## Alternatives Considered
1. **In-Process Monolith Execution:** Running scripts inside the API server process. Rejected as an intolerable security hazard; any bug or runaway process would compromise or crash the entire control plane.
2. **Unrestricted SSH / Docker-in-Docker Shell Execution:** Allowing responders to submit arbitrary bash commands. Rejected because sanitizing arbitrary shell syntax against command injection is virtually impossible.

## Consequences
### Positive
- Hard security perimeter between incident governance and infrastructure mutation.
- Elimination of remote code execution (RCE) attack vectors in the control plane.
- Auditable least-privilege identity for each runner instance (e.g., scoped Kubernetes ServiceAccount).
- Foundation for future multi-cluster / on-premises runner agents behind corporate firewalls.

### Negative / Trade-offs
- Requires an asynchronous dispatch and log streaming protocol between the control plane and runner.
- Adds one additional process/container to deployment topologies.
