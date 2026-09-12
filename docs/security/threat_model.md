# TITAN Threat Model & Security Posture

**Document Version:** 1.0  
**Phase:** Security by Design  
**Framework:** STRIDE & OWASP Top 10  
**Date:** September 2026  

---

## 1. Security Philosophy

Project TITAN operates under a **Zero-Trust Security Architecture**. Because TITAN is empowered to orchestrate recovery actions across mission-critical infrastructure, any compromise of the control plane or runner could lead to catastrophic outages or lateral privilege escalation. Security controls are embedded directly into every layer rather than applied as an afterthought.

---

## 2. Assets & Trust Boundaries

```text
       UNTRUSTED INTERNET
              │
══════════════╪══════════════════════════════════════════ Trust Boundary 1 (Perimeter)
              ▼
   [ TITAN Ingress Gateway ]
              │
══════════════╪══════════════════════════════════════════ Trust Boundary 2 (Internal Network)
              ▼
   [ Redis Streams Buffer ]
              ▼
   [ TITAN Core API & Workers ] ◄──► [ PostgreSQL 16+ ] (Append-Only Audit)
              │
══════════════╪══════════════════════════════════════════ Trust Boundary 3 (Execution Boundary)
              ▼ (mTLS / Signed Tasks)
   [ Isolated Runbook Runner ]
              │
══════════════╪══════════════════════════════════════════ Trust Boundary 4 (Infrastructure)
              ▼
   [ Target Infrastructure ] (Kubernetes API, Internal Microservices)
```

### High-Value Assets
1. **Infrastructure Execution Capabilities:** Ability to restart pods, execute API calls, or scale clusters.
2. **Third-Party API Credentials & Secrets:** Cloud provider IAM tokens, webhook signing keys, database passwords.
3. **Cryptographic Audit Logs:** Historical record of actions, approvals, and system state transitions.
4. **Active Incident Context:** Confidential telemetry data regarding proprietary architectures and vulnerabilities.

---

## 3. STRIDE Threat Analysis & Mitigations

### 3.1 Spoofing (Identity Deception)
- **Threat:** Malicious actor submits synthetic alert webhooks to trigger fake incidents and spam on-call engineers.
- **Mitigation:**
  - HMAC-SHA256 signature verification enforced at the edge gateway.
  - Secret key rotation mechanism.
  - IP whitelisting for known telemetry egress CIDR ranges.

### 3.2 Tampering (Data Manipulation)
- **Threat:** An attacker or rogue employee alters the audit trail to hide unauthorized changes or modifies runbook definitions to inject malicious shell commands.
- **Mitigation:**
  - Database-level revocation of `UPDATE` and `DELETE` on `audit_logs`.
  - Cryptographic hash-chaining ($\text{RowHash}_i = \text{HMAC}(\text{RowHash}_{i-1}, \dots)$).
  - Strict JSON Schema validation on runbook YAML; prohibition of arbitrary shell strings.

### 3.3 Repudiation (Denying Actions)
- **Threat:** An engineer denies having authorized a destructive cluster drain operation during an outage.
- **Mitigation:**
  - Dual-custody approval requires non-repudiable cryptographic signatures and records user ID, IP address, user agent, and timestamp into the immutable audit trail.
  - Separation of duties: Requester cannot approve their own runbook execution.

### 3.4 Information Disclosure (Data Leakage)
- **Threat:** Telemetry logs or runbook outputs contain sensitive customer PII or plaintext database credentials displayed in the web war room.
- **Mitigation:**
  - Automated regex-based secret scrubbing (detecting AWS keys, JWTs, private keys) in log streaming pipelines before broadcasting.
  - AES-256-GCM encryption for stored secrets at rest.
  - TLS 1.3 enforced for all traffic in transit.

### 3.5 Denial of Service (Resource Exhaustion)
- **Threat:** An alert storm of 50,000 requests/second exhausts API memory and crashes the control plane.
- **Mitigation:**
  - Ingress Token-Bucket rate limiting at Fastify layer.
  - Decoupling via Redis Streams prevents database connection exhaustion.
  - Strict payload size limits ($\le 1\text{ MB}$).

### 3.6 Elevation of Privilege (Unauthorized Actions)
- **Threat:** An observer user manipulates API calls to trigger a P1 production database restart.
- **Mitigation:**
  - Strict RBAC middleware enforced on all mutations.
  - P1 destructive runbooks require Incident Commander or Admin role authorization.
  - Runner container executes with dropped Linux capabilities and scoped ServiceAccount.
