# TITAN Local Development Guide

**Document Version:** 1.0  
**Phase:** Phase 4 — Foundation  
**Audience:** TITAN Platform Contributors  

---

## 1. Prerequisites

Before running TITAN locally, ensure your workstation has:
- **Node.js:** `v22.0.0` or higher (LTS recommended).
- **npm:** `v10.0.0` or higher.
- **Docker & Docker Compose:** Docker Engine 24+ / Docker Compose v2.20+.
- **Git:** 2.40+.

---

## 2. Quickstart (One-Command Bootstrapping)

### Step 1: Clone and Configure Environment
```bash
git clone https://github.com/Ft-sumukh/titan-.git
cd titan-
cp .env.example .env
```

### Step 2: Install Monorepo Dependencies
```bash
npm install
```

### Step 3: Start Infrastructure Services (PostgreSQL, Redis, MinIO)
```bash
npm run dev:infra
```
*This launches:*
- **PostgreSQL 16** on `localhost:5432` with auto-initialized schemas and seed users.
- **Redis 7.2** on `localhost:6379` with AOF persistence enabled.
- **MinIO S3** on `localhost:9000` (Console on `localhost:9001`).

### Step 4: Run Backend Core
```bash
npm run dev:backend
```
*Starts Fastify Ingestion Gateway & Core API on `http://localhost:8000` (and `http://localhost:8080`).*

### Step 5: Run Frontend Console
```bash
npm run dev:frontend
```
*Starts Next.js War Room UI on `http://localhost:3000`.*

---

## 3. Verifying the Local Environment

### 1. Check Infrastructure Health
```bash
docker ps
```
Both `titan-postgres` and `titan-redis` should report `(healthy)`.

### 2. Verify API Health Endpoint
```bash
curl http://localhost:8000/health
```
Expected response:
```json
{"status":"ok","database":"connected","redis":"connected","uptime":12.4}
```

### 3. Send Synthetic Webhook Alert
```bash
curl -X POST http://localhost:8080/api/v1/ingress/webhook \
  -H "Content-Type: application/json" \
  -H "X-Titan-Source: generic" \
  -H "X-Titan-Timestamp: $(date +%s)" \
  -H "X-Titan-Signature: sha256=test_signature" \
  -d '{
    "alertName": "HighMemoryUtilization",
    "severity": "CRITICAL",
    "service": "checkout-service",
    "environment": "production",
    "summary": "Node memory pressure exceeded 90%"
  }'
```
Expected response:
```json
{"status":"accepted","event_id":"evt_...","timestamp":"..."}
```

---

## 4. Running Quality Checks & Tests

```bash
# Run TypeScript compilation check across all packages
npm run typecheck

# Run unit and integration tests
npm run test

# Run code linter
npm run lint
```
