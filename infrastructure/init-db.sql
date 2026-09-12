-- ==============================================================================
-- PROJECT TITAN — Database Initialization Script
-- Engine: PostgreSQL 16+
-- Modules: Ingestion, Correlation, Incidents, Runbooks, Audit Trails
-- ==============================================================================

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- Clean drop for clean bootstrapping
-- (Only executed on initial volume creation)

-- 1. ENUM TYPES
CREATE TYPE incident_status AS ENUM (
    'TRIGGERED',
    'ACKNOWLEDGED',
    'INVESTIGATING',
    'MITIGATING',
    'RESOLVED',
    'CLOSED'
);

CREATE TYPE incident_priority AS ENUM ('P1', 'P2', 'P3', 'P4');

CREATE TYPE user_role AS ENUM (
    'ADMIN',
    'INCIDENT_COMMANDER',
    'RESPONDER',
    'OBSERVER'
);

CREATE TYPE execution_status AS ENUM (
    'PENDING_APPROVAL',
    'APPROVED',
    'REJECTED',
    'RUNNING',
    'COMPLETED',
    'FAILED',
    'ROLLED_BACK'
);

CREATE TYPE alert_severity AS ENUM (
    'CRITICAL',
    'HIGH',
    'MEDIUM',
    'LOW',
    'INFO'
);

-- 2. TENANCY & USERS
CREATE TABLE IF NOT EXISTS tenants (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    slug VARCHAR(64) NOT NULL UNIQUE,
    name VARCHAR(128) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    email VARCHAR(255) NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    full_name VARCHAR(128) NOT NULL,
    role user_role NOT NULL DEFAULT 'RESPONDER',
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_tenant_user_email UNIQUE (tenant_id, email)
);

-- 3. CORE INCIDENTS TABLE
CREATE TABLE IF NOT EXISTS incidents (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    incident_number BIGSERIAL NOT NULL,
    title VARCHAR(255) NOT NULL,
    summary TEXT,
    status incident_status NOT NULL DEFAULT 'TRIGGERED',
    priority incident_priority NOT NULL DEFAULT 'P3',
    commander_id UUID REFERENCES users(id) ON DELETE SET NULL,
    lead_responder_id UUID REFERENCES users(id) ON DELETE SET NULL,
    service_name VARCHAR(128) NOT NULL,
    environment VARCHAR(64) NOT NULL DEFAULT 'production',
    alert_count INT NOT NULL DEFAULT 1,
    version INT NOT NULL DEFAULT 1, -- Optimistic Concurrency Control
    triggered_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    acknowledged_at TIMESTAMPTZ,
    mitigated_at TIMESTAMPTZ,
    resolved_at TIMESTAMPTZ,
    closed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_tenant_incident_number UNIQUE (tenant_id, incident_number)
);

CREATE INDEX idx_incidents_tenant_status ON incidents (tenant_id, status);
CREATE INDEX idx_incidents_tenant_priority ON incidents (tenant_id, priority);
CREATE INDEX idx_incidents_service ON incidents (tenant_id, service_name, environment);

-- 4. INGESTED TELEMETRY ALERTS (Normalized CloudEvents)
CREATE TABLE IF NOT EXISTS alerts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    event_id VARCHAR(128) NOT NULL UNIQUE,
    fingerprint CHAR(64) NOT NULL,
    source VARCHAR(255) NOT NULL,
    alert_name VARCHAR(128) NOT NULL,
    severity alert_severity NOT NULL DEFAULT 'MEDIUM',
    service VARCHAR(128) NOT NULL,
    environment VARCHAR(64) NOT NULL DEFAULT 'production',
    payload JSONB NOT NULL,
    received_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_alerts_fingerprint ON alerts (tenant_id, fingerprint, received_at DESC);
CREATE INDEX idx_alerts_payload_gin ON alerts USING GIN (payload);

-- 5. INCIDENT-ALERT CORRELATION LINK TABLE
CREATE TABLE IF NOT EXISTS incident_alerts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    incident_id UUID NOT NULL REFERENCES incidents(id) ON DELETE CASCADE,
    alert_id UUID NOT NULL REFERENCES alerts(id) ON DELETE CASCADE,
    correlation_score NUMERIC(5,2) NOT NULL DEFAULT 1.00,
    linked_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_incident_alert UNIQUE (incident_id, alert_id)
);

CREATE INDEX idx_incident_alerts_incident ON incident_alerts (incident_id);

-- 6. DECLARATIVE RUNBOOKS
CREATE TABLE IF NOT EXISTS runbooks (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    slug VARCHAR(128) NOT NULL,
    name VARCHAR(255) NOT NULL,
    description TEXT,
    version INT NOT NULL DEFAULT 1,
    definition_yaml TEXT NOT NULL,
    definition_json JSONB NOT NULL,
    requires_approval BOOLEAN NOT NULL DEFAULT FALSE,
    min_role user_role NOT NULL DEFAULT 'RESPONDER',
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_by UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_tenant_runbook_slug UNIQUE (tenant_id, slug, version)
);

-- 7. RUNBOOK EXECUTION INSTANCES
CREATE TABLE IF NOT EXISTS runbook_executions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    incident_id UUID REFERENCES incidents(id) ON DELETE CASCADE,
    runbook_id UUID NOT NULL REFERENCES runbooks(id),
    status execution_status NOT NULL DEFAULT 'PENDING_APPROVAL',
    requester_id UUID NOT NULL REFERENCES users(id),
    approver_id UUID REFERENCES users(id),
    parameters JSONB NOT NULL DEFAULT '{}'::JSONB,
    execution_logs TEXT,
    step_results JSONB NOT NULL DEFAULT '[]'::JSONB,
    started_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_runbook_exec_incident ON runbook_executions (incident_id);
CREATE INDEX idx_runbook_exec_status ON runbook_executions (status);

-- 8. REAL-TIME INCIDENT TIMELINE EVENTS
CREATE TABLE IF NOT EXISTS timeline_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    incident_id UUID NOT NULL REFERENCES incidents(id) ON DELETE CASCADE,
    actor_id UUID REFERENCES users(id) ON DELETE SET NULL,
    event_type VARCHAR(64) NOT NULL, -- STATUS_CHANGE, NOTE, RUNBOOK_EXECUTION, SYSTEM
    content TEXT NOT NULL,
    metadata JSONB NOT NULL DEFAULT '{}'::JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_timeline_incident_time ON timeline_events (incident_id, created_at ASC);

-- 9. APPEND-ONLY CRYPTOGRAPHIC AUDIT LOG
CREATE TABLE IF NOT EXISTS audit_logs (
    id BIGSERIAL PRIMARY KEY,
    tenant_id UUID NOT NULL,
    actor_id UUID,
    actor_ip INET NOT NULL DEFAULT '127.0.0.1',
    action VARCHAR(64) NOT NULL,
    entity_type VARCHAR(64) NOT NULL,
    entity_id UUID NOT NULL,
    before_state JSONB,
    after_state JSONB,
    prev_hash CHAR(64) NOT NULL,
    row_hash CHAR(64) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_audit_tenant_entity ON audit_logs (tenant_id, entity_type, entity_id);
CREATE INDEX idx_audit_created ON audit_logs (created_at DESC);

-- ==============================================================================
-- INITIAL SEED DATA (Bootstrap Default Organization & Admin)
-- ==============================================================================
INSERT INTO tenants (id, slug, name)
VALUES ('00000000-0000-0000-0000-000000000001', 'titan-core', 'TITAN Global Production')
ON CONFLICT (slug) DO NOTHING;

-- Default Admin User (Password: "TitanAdmin2026!", bcrypt hashed)
INSERT INTO users (id, tenant_id, email, password_hash, full_name, role)
VALUES (
    '00000000-0000-0000-0000-000000000002',
    '00000000-0000-0000-0000-000000000001',
    'admin@titan.internal',
    '$2a$12$e8vKkJ8o26V.HfgH.WqV.e9uP86uQ2t2c3EkeuW1w6f9m5N3JpPq2',
    'TITAN System Administrator',
    'ADMIN'
)
ON CONFLICT (tenant_id, email) DO NOTHING;

-- Initial Seed Runbook
INSERT INTO runbooks (
    id, tenant_id, slug, name, description, version, definition_yaml, definition_json, requires_approval, min_role
)
VALUES (
    '00000000-0000-0000-0000-000000000003',
    '00000000-0000-0000-0000-000000000001',
    'drain-and-scale-db-pool',
    'Drain Blocked Queries & Scale Connection Pool',
    'Terminates idle-in-transaction queries and scales database connection pool for degraded services.',
    1,
    'version: titan/v1alpha1\nkind: Runbook\nmetadata:\n  id: drain-and-scale-db-pool\nspec:\n  requires_approval: true\n',
    '{"version":"titan/v1alpha1","kind":"Runbook","spec":{"requires_approval":true}}'::JSONB,
    TRUE,
    'INCIDENT_COMMANDER'
)
ON CONFLICT (tenant_id, slug, version) DO NOTHING;
