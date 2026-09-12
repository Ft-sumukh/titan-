# TITAN API & Ingress Specifications

**Directory:** `/docs/api`  
**Standard:** OpenAPI 3.1 & CloudEvents v1.0  

---

## 1. Overview

TITAN exposes three primary application interfaces:
1. **Ingress Gateway API (`/api/v1/ingress/*`):** High-throughput, HMAC-authenticated webhook ingestion for external telemetry systems (Prometheus, Datadog, AWS CloudWatch, generic JSON).
2. **Core REST API (`/api/v1/*`):** Enterprise incident management, runbook scheduling, user administration, and audit logs.
3. **Real-Time WebSocket Gateway (`/ws/war-room/*`):** Bi-directional state synchronization, responder presence, and live log streaming.

---

## 2. Ingress API Specification

### Endpoint: `POST /api/v1/ingress/webhook`
Ingests an external alert webhook, validates the HMAC-SHA256 signature, normalizes the payload into a CloudEvent, and buffers the event into Redis Streams.

#### Headers
| Header | Required | Type | Description |
| :--- | :---: | :--- | :--- |
| `Content-Type` | **Yes** | `string` | Must be `application/json`. |
| `X-Titan-Signature` | **Yes** | `string` | Hex-encoded HMAC-SHA256 signature: `sha256=<hex>`. |
| `X-Titan-Timestamp` | **Yes** | `string` | ISO-8601 or epoch timestamp for replay protection ($\pm 300\text{s}$). |
| `X-Titan-Source` | **Yes** | `string` | Provider identifier: `prometheus`, `datadog`, `aws_sns`, or `generic`. |

#### Request Payload (Example: Prometheus Alertmanager)
```json
{
  "receiver": "titan-webhook",
  "status": "firing",
  "alerts": [
    {
      "status": "firing",
      "labels": {
        "alertname": "PostgresPoolSaturated",
        "severity": "critical",
        "service": "payments-service",
        "env": "production",
        "cluster": "us-east-1"
      },
      "annotations": {
        "summary": "Database connection pool saturated (> 95%)",
        "runbook_url": "https://wiki.internal/runbooks/db-pool"
      },
      "startsAt": "2026-09-12T16:15:30.000Z"
    }
  ]
}
```

#### Response (HTTP 202 Accepted)
```json
{
  "status": "accepted",
  "event_id": "evt_9a4f210e-862d-48e2-9b2f-412e431d0445",
  "timestamp": "2026-09-12T16:15:30.125Z"
}
```

---

## 3. Incident Management REST API

### Key Endpoints

| Method | Path | Required Role | Description |
| :--- | :--- | :--- | :--- |
| `GET` | `/api/v1/incidents` | `Observer`+ | List active and historical incidents with filtering. |
| `GET` | `/api/v1/incidents/:id` | `Observer`+ | Retrieve full incident details, linked alerts, and timeline. |
| `PATCH` | `/api/v1/incidents/:id/status` | `Responder`+ | Advance incident state machine (`Triggered` $\rightarrow$ `Acknowledged` etc.). |
| `POST` | `/api/v1/incidents/:id/timeline` | `Responder`+ | Add note or diagnostic artifact to the incident timeline. |
| `POST` | `/api/v1/incidents/:id/runbooks/exec` | `Responder`+ | Submit a runbook execution request. |
| `POST` | `/api/v1/executions/:id/approve` | `IncidentCommander`+ | Dual-custody approval for a pending execution. |
| `GET` | `/api/v1/audit/logs` | `Admin` | Query append-only audit trail with hash verification. |

---

## 4. WebSocket War-Room Gateway

### Endpoint: `GET /ws/war-room/:incidentId`
Upgrades an authenticated HTTP connection to a persistent bi-directional WebSocket.

#### Connection Handshake
- Authenticated via JWT bearer token in query parameter or `Sec-WebSocket-Protocol` header.

#### Messages Dispatched to Client
```json
{
  "type": "INCIDENT_UPDATED",
  "incidentId": "00000000-0000-0000-0000-000000000010",
  "status": "MITIGATING",
  "version": 4,
  "updatedAt": "2026-09-12T16:20:15.000Z",
  "actor": {
    "id": "00000000-0000-0000-0000-000000000002",
    "name": "Sarah Chen"
  }
}
```

#### Runbook Execution Log Stream
```json
{
  "type": "RUNBOOK_LOG_CHUNK",
  "executionId": "exec_49a21b",
  "stepId": "terminate-idle-queries",
  "stream": "stdout",
  "chunk": "Terminated 14 idle connections in state 'idle in transaction' (duration > 60s)\n"
}
```
