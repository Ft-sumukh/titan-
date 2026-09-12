'use client';

import React, { useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  Play,
  Terminal,
  FileText,
  Radio,
  Send,
  Activity,
  Layers,
  Zap,
} from 'lucide-react';

interface Incident {
  id: string;
  incident_number: number;
  title: string;
  summary: string;
  status: 'TRIGGERED' | 'ACKNOWLEDGED' | 'INVESTIGATING' | 'MITIGATING' | 'RESOLVED' | 'CLOSED';
  priority: 'P1' | 'P2' | 'P3' | 'P4';
  service_name: string;
  environment: string;
  alert_count: number;
  version: number;
  triggered_at: string;
  acknowledged_at: string | null;
  mitigated_at: string | null;
  resolved_at: string | null;
}

const INITIAL_INCIDENTS: Incident[] = [
  {
    id: '00000000-0000-0000-0000-000000000010',
    incident_number: 1042,
    title: 'PostgreSQL Connection Pool Exhaustion (> 95%)',
    summary: 'High transaction volume in checkout caused payments database pool saturation and thread blockages.',
    status: 'TRIGGERED',
    priority: 'P1',
    service_name: 'payments-service',
    environment: 'production',
    alert_count: 24,
    version: 1,
    triggered_at: '2026-09-12T16:15:30Z',
    acknowledged_at: null,
    mitigated_at: null,
    resolved_at: null,
  },
  {
    id: '00000000-0000-0000-0000-000000000011',
    incident_number: 1041,
    title: 'Kubernetes Pod CrashLoopBackOff: Auth Workers',
    summary: 'Memory limit exceeded on auth-service worker replica set in prod-us-east-1.',
    status: 'INVESTIGATING',
    priority: 'P2',
    service_name: 'auth-service',
    environment: 'production',
    alert_count: 7,
    version: 3,
    triggered_at: '2026-09-12T15:45:10Z',
    acknowledged_at: '2026-09-12T15:47:00Z',
    mitigated_at: null,
    resolved_at: null,
  },
  {
    id: '00000000-0000-0000-0000-000000000012',
    incident_number: 1040,
    title: 'Redis Cache Latency Spike (p99 > 250ms)',
    summary: 'High cache eviction rate leading to slow reads on user session store.',
    status: 'RESOLVED',
    priority: 'P3',
    service_name: 'session-cache',
    environment: 'production',
    alert_count: 3,
    version: 4,
    triggered_at: '2026-09-12T14:10:00Z',
    acknowledged_at: '2026-09-12T14:12:00Z',
    mitigated_at: '2026-09-12T14:22:00Z',
    resolved_at: '2026-09-12T14:30:00Z',
  },
];

export default function WarRoomDashboard() {
  const [incidents, setIncidents] = useState<Incident[]>(INITIAL_INCIDENTS);
  const [selectedIncidentId, setSelectedIncidentId] = useState<string>('00000000-0000-0000-0000-000000000010');
  const [activeTab, setActiveTab] = useState<'timeline' | 'runbooks' | 'alerts' | 'postmortem'>('timeline');

  // Runbook Execution State
  const [targetService, setTargetService] = useState('payments-service');
  const [maxIdleSeconds, setMaxIdleSeconds] = useState(60);
  const [isDryRun, setIsDryRun] = useState(false);
  const [executionLogs, setExecutionLogs] = useState<string[]>([
    '[SYSTEM] Runbook engine initialized. Select a remediation workflow to execute.',
  ]);
  const [isExecuting, setIsExecuting] = useState(false);
  const [showApprovalModal, setShowApprovalModal] = useState(false);

  // Timeline events for selected incident
  const [timeline, setTimeline] = useState<Array<{ time: string; type: string; message: string }>>([
    {
      time: '16:15:30 UTC',
      type: 'ALERT_INGESTED',
      message: 'Initial Prometheus alert received: PostgresPoolSaturated (CRITICAL)',
    },
    {
      time: '16:15:32 UTC',
      type: 'CORRELATION',
      message: 'Aggregated 24 cascading alerts under payments-service (Deduplication ratio: 95.8%)',
    },
    {
      time: '16:15:33 UTC',
      type: 'INCIDENT_CREATED',
      message: 'Canonical Incident INC-1042 triggered [P1 - Critical]',
    },
  ]);

  const selectedIncident = incidents.find((inc) => inc.id === selectedIncidentId) || incidents[0]!;

  // Handle Legal State Transitions
  const handleTransition = (newStatus: Incident['status']) => {
    setIncidents((prev) =>
      prev.map((inc) => {
        if (inc.id === selectedIncident.id) {
          const now = new Date().toISOString();
          return {
            ...inc,
            status: newStatus,
            version: inc.version + 1,
            acknowledged_at: newStatus === 'ACKNOWLEDGED' ? now : inc.acknowledged_at,
            mitigated_at: newStatus === 'MITIGATING' ? now : inc.mitigated_at,
            resolved_at: newStatus === 'RESOLVED' ? now : inc.resolved_at,
          };
        }
        return inc;
      })
    );

    const nowStr = new Date().toLocaleTimeString('en-US', { hour12: false }) + ' UTC';
    setTimeline((prev) => [
      ...prev,
      {
        time: nowStr,
        type: 'STATUS_CHANGE',
        message: `Incident status transitioned to ${newStatus}`,
      },
    ]);
  };

  // Runbook Execution Simulation
  const handleRunbookTrigger = () => {
    if (!isDryRun) {
      setShowApprovalModal(true);
      return;
    }

    // Execute dry run immediately
    executeRunbookInternal(true, 'DRY_RUN');
  };

  const executeRunbookInternal = (dryRun: boolean, approver: string) => {
    setIsExecuting(true);
    setShowApprovalModal(false);

    const now = new Date().toLocaleTimeString('en-US', { hour12: false });

    setExecutionLogs((prev) => [
      ...prev,
      `[${now}] [DISPATCH] Invoking runbook 'drain-and-scale-db-pool' (Dry-Run: ${dryRun})`,
      `[${now}] [AUTH] Dual-custody sign-off verified: Authorized by ${approver}`,
      `[${now}] [STEP-1] Checking current pool health for ${targetService}...`,
      `[${now}] [STEP-1] HTTP 200 OK: Saturation confirmed at 96.4%`,
      `[${now}] [STEP-2] Terminating queries idle > ${maxIdleSeconds}s...`,
      `[${now}] [STEP-2] Success: Terminated 18 idle connections. Saturation dropped to 42%.`,
      `[${now}] [VERIFY] Assertions passed: pool_health_status is NOMINAL.`,
      `[${now}] [COMPLETE] Runbook execution completed successfully (Duration: 1.4s)`,
    ]);

    setIsExecuting(false);

    // If live execution, transition incident to MITIGATING
    if (!dryRun && selectedIncident.status !== 'RESOLVED') {
      handleTransition('MITIGATING');
    }
  };

  const getPriorityColor = (p: Incident['priority']) => {
    switch (p) {
      case 'P1':
        return 'bg-red-500/20 text-red-400 border-red-500/40';
      case 'P2':
        return 'bg-orange-500/20 text-orange-400 border-orange-500/40';
      case 'P3':
        return 'bg-amber-500/20 text-amber-400 border-amber-500/40';
      case 'P4':
        return 'bg-blue-500/20 text-blue-400 border-blue-500/40';
    }
  };

  const getStatusColor = (status: Incident['status']) => {
    switch (status) {
      case 'TRIGGERED':
        return 'bg-red-950 text-red-400 border-red-800 animate-pulse';
      case 'ACKNOWLEDGED':
        return 'bg-amber-950 text-amber-300 border-amber-800';
      case 'INVESTIGATING':
        return 'bg-blue-950 text-blue-400 border-blue-800';
      case 'MITIGATING':
        return 'bg-purple-950 text-purple-400 border-purple-800';
      case 'RESOLVED':
        return 'bg-emerald-950 text-emerald-400 border-emerald-800';
      case 'CLOSED':
        return 'bg-slate-900 text-slate-400 border-slate-800';
    }
  };

  return (
    <div className="flex-1 flex overflow-hidden">
      {/* 1. Incident Navigation Queue */}
      <aside className="w-80 border-r border-slate-800 bg-[#0d131f] flex flex-col">
        <div className="p-4 border-b border-slate-800 flex items-center justify-between">
          <div className="flex items-center space-x-2">
            <Radio className="w-4 h-4 text-blue-400 animate-pulse" />
            <h2 className="font-semibold text-sm tracking-wide text-slate-200">Incident Feed</h2>
          </div>
          <span className="px-2 py-0.5 rounded-full text-xs bg-slate-800 text-slate-300 font-mono">
            {incidents.length}
          </span>
        </div>

        <div className="flex-1 overflow-y-auto p-3 space-y-2">
          {incidents.map((inc) => (
            <button
              key={inc.id}
              onClick={() => setSelectedIncidentId(inc.id)}
              className={`w-full text-left p-3.5 rounded-lg border transition-all duration-150 ${
                inc.id === selectedIncident.id
                  ? 'bg-slate-800/80 border-blue-500/60 shadow-md shadow-blue-500/5'
                  : 'bg-slate-900/40 border-slate-800/60 hover:bg-slate-850 hover:border-slate-700'
              }`}
            >
              <div className="flex items-center justify-between mb-1.5">
                <span className={`px-2 py-0.5 text-[11px] font-bold rounded border ${getPriorityColor(inc.priority)}`}>
                  {inc.priority}
                </span>
                <span className={`px-2 py-0.5 text-[10px] font-semibold rounded border ${getStatusColor(inc.status)}`}>
                  {inc.status}
                </span>
              </div>
              <h3 className="font-medium text-xs text-slate-100 line-clamp-2 leading-snug mb-2">{inc.title}</h3>
              <div className="flex items-center justify-between text-[11px] text-slate-400">
                <span className="font-mono text-slate-300">INC-{inc.incident_number}</span>
                <span className="flex items-center">
                  <Layers className="w-3 h-3 mr-1 text-slate-500" />
                  {inc.alert_count} alerts
                </span>
              </div>
            </button>
          ))}
        </div>

        {/* Quick Synthetic Ingestion Trigger */}
        <div className="p-3 border-t border-slate-800 bg-[#0a0f19]">
          <button
            onClick={() => {
              const newInc: Incident = {
                id: `inc-${Date.now()}`,
                incident_number: incidents.length + 1040,
                title: 'HighMemoryPressure on redis-cluster-node-03',
                summary: 'Synthetic Prometheus alert flood simulated from control plane.',
                status: 'TRIGGERED',
                priority: 'P2',
                service_name: 'redis-cluster',
                environment: 'production',
                alert_count: 14,
                version: 1,
                triggered_at: new Date().toISOString(),
                acknowledged_at: null,
                mitigated_at: null,
                resolved_at: null,
              };
              setIncidents([newInc, ...incidents]);
              setSelectedIncidentId(newInc.id);
            }}
            className="w-full flex items-center justify-center space-x-2 py-2 px-3 rounded bg-slate-800 hover:bg-slate-700 text-xs text-slate-200 font-medium border border-slate-700 transition"
          >
            <Zap className="w-3.5 h-3.5 text-amber-400" />
            <span>Simulate Telemetry Alert Storm</span>
          </button>
        </div>
      </aside>

      {/* 2. Main War Room Workspace */}
      <section className="flex-1 flex flex-col bg-[#0a0d14] overflow-y-auto">
        {/* Incident Command Header */}
        <div className="p-6 border-b border-slate-800 bg-[#0d131f]/50">
          <div className="flex items-start justify-between">
            <div>
              <div className="flex items-center space-x-3 mb-2">
                <span className={`px-2.5 py-1 text-xs font-bold rounded border ${getPriorityColor(selectedIncident.priority)}`}>
                  {selectedIncident.priority} CRITICAL
                </span>
                <span className="text-sm font-mono text-slate-400">INC-{selectedIncident.incident_number}</span>
                <span className="text-xs text-slate-400">• Service: <strong className="text-slate-200">{selectedIncident.service_name}</strong></span>
                <span className="text-xs text-slate-400">• Env: <strong className="text-slate-200">{selectedIncident.environment}</strong></span>
              </div>
              <h1 className="text-xl font-bold text-white tracking-tight">{selectedIncident.title}</h1>
              <p className="text-xs text-slate-300 mt-1 max-w-3xl leading-relaxed">{selectedIncident.summary}</p>
            </div>

            {/* Deterministic State Transition Action Bar */}
            <div className="flex items-center space-x-2 bg-slate-900/80 p-1.5 rounded-lg border border-slate-800">
              {selectedIncident.status === 'TRIGGERED' && (
                <button
                  onClick={() => handleTransition('ACKNOWLEDGED')}
                  className="px-3 py-1.5 bg-amber-600 hover:bg-amber-500 text-white rounded text-xs font-semibold flex items-center space-x-1.5 shadow"
                >
                  <Clock className="w-3.5 h-3.5" />
                  <span>Acknowledge</span>
                </button>
              )}

              {(selectedIncident.status === 'ACKNOWLEDGED' || selectedIncident.status === 'TRIGGERED') && (
                <button
                  onClick={() => handleTransition('INVESTIGATING')}
                  className="px-3 py-1.5 bg-blue-600 hover:bg-blue-500 text-white rounded text-xs font-semibold flex items-center space-x-1.5"
                >
                  <Activity className="w-3.5 h-3.5" />
                  <span>Investigate</span>
                </button>
              )}

              {selectedIncident.status !== 'MITIGATING' && selectedIncident.status !== 'RESOLVED' && (
                <button
                  onClick={() => handleTransition('MITIGATING')}
                  className="px-3 py-1.5 bg-purple-600 hover:bg-purple-500 text-white rounded text-xs font-semibold flex items-center space-x-1.5"
                >
                  <Play className="w-3.5 h-3.5" />
                  <span>Mitigate</span>
                </button>
              )}

              {selectedIncident.status !== 'RESOLVED' && (
                <button
                  onClick={() => handleTransition('RESOLVED')}
                  className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded text-xs font-semibold flex items-center space-x-1.5"
                >
                  <CheckCircle2 className="w-3.5 h-3.5" />
                  <span>Resolve</span>
                </button>
              )}

              {selectedIncident.status === 'RESOLVED' && (
                <div className="flex items-center space-x-2 px-3 py-1.5 text-xs font-medium text-emerald-400 bg-emerald-950/40 border border-emerald-800/60 rounded">
                  <CheckCircle2 className="w-4 h-4" />
                  <span>Incident Mitigated & Resolved</span>
                </div>
              )}
            </div>
          </div>

          {/* Quick Metrics Bar */}
          <div className="mt-6 pt-4 border-t border-slate-800/80 grid grid-cols-4 gap-4">
            <div className="bg-slate-900/60 p-3 rounded border border-slate-800">
              <span className="text-[11px] text-slate-400 uppercase tracking-wider block">Time to Acknowledge</span>
              <span className="text-sm font-semibold text-white mt-0.5 block font-mono">
                {selectedIncident.acknowledged_at ? '< 2m (Met SLA)' : 'Pending Responder'}
              </span>
            </div>
            <div className="bg-slate-900/60 p-3 rounded border border-slate-800">
              <span className="text-[11px] text-slate-400 uppercase tracking-wider block">Time to Mitigate</span>
              <span className="text-sm font-semibold text-white mt-0.5 block font-mono">
                {selectedIncident.mitigated_at ? '12.4m (Met SLA)' : 'Active Incident'}
              </span>
            </div>
            <div className="bg-slate-900/60 p-3 rounded border border-slate-800">
              <span className="text-[11px] text-slate-400 uppercase tracking-wider block">Correlated Alert Noise</span>
              <span className="text-sm font-semibold text-emerald-400 mt-0.5 block font-mono">
                {selectedIncident.alert_count} signals reduced to 1
              </span>
            </div>
            <div className="bg-slate-900/60 p-3 rounded border border-slate-800">
              <span className="text-[11px] text-slate-400 uppercase tracking-wider block">State Machine Version</span>
              <span className="text-sm font-semibold text-white mt-0.5 block font-mono">
                v{selectedIncident.version} (Optimistic Locking)
              </span>
            </div>
          </div>
        </div>

        {/* Tab Navigation */}
        <div className="px-6 border-b border-slate-800 bg-[#0d131f]/30 flex space-x-6">
          <button
            onClick={() => setActiveTab('timeline')}
            className={`py-3 text-xs font-semibold border-b-2 transition flex items-center space-x-2 ${
              activeTab === 'timeline'
                ? 'border-blue-500 text-blue-400'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            <Clock className="w-3.5 h-3.5" />
            <span>War Room Timeline</span>
          </button>
          <button
            onClick={() => setActiveTab('runbooks')}
            className={`py-3 text-xs font-semibold border-b-2 transition flex items-center space-x-2 ${
              activeTab === 'runbooks'
                ? 'border-blue-500 text-blue-400'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            <Terminal className="w-3.5 h-3.5" />
            <span>Declarative Runbooks</span>
          </button>
          <button
            onClick={() => setActiveTab('alerts')}
            className={`py-3 text-xs font-semibold border-b-2 transition flex items-center space-x-2 ${
              activeTab === 'alerts'
                ? 'border-blue-500 text-blue-400'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            <AlertTriangle className="w-3.5 h-3.5" />
            <span>Telemetry Signals ({selectedIncident.alert_count})</span>
          </button>
          <button
            onClick={() => setActiveTab('postmortem')}
            className={`py-3 text-xs font-semibold border-b-2 transition flex items-center space-x-2 ${
              activeTab === 'postmortem'
                ? 'border-blue-500 text-blue-400'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            <FileText className="w-3.5 h-3.5" />
            <span>Postmortem Report</span>
          </button>
        </div>

        {/* Tab Contents */}
        <div className="flex-1 p-6">
          {/* TAB 1: Live Timeline */}
          {activeTab === 'timeline' && (
            <div className="space-y-4 max-w-4xl">
              <div className="space-y-3">
                {timeline.map((item, idx) => (
                  <div key={idx} className="flex items-start space-x-4 p-3 rounded-lg bg-slate-900/50 border border-slate-800/80">
                    <span className="font-mono text-xs text-blue-400 whitespace-nowrap">{item.time}</span>
                    <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-slate-800 text-slate-300 uppercase">
                      {item.type}
                    </span>
                    <p className="text-xs text-slate-200 flex-1">{item.message}</p>
                  </div>
                ))}
              </div>

              {/* Add Note to Timeline */}
              <div className="pt-4 flex items-center space-x-3">
                <input
                  type="text"
                  placeholder="Broadcast note or diagnostic snapshot to incident war room..."
                  className="flex-1 bg-slate-900 border border-slate-700 rounded px-3.5 py-2 text-xs text-slate-100 placeholder-slate-500 focus:outline-none focus:border-blue-500"
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && e.currentTarget.value.trim()) {
                      const nowStr = new Date().toLocaleTimeString('en-US', { hour12: false }) + ' UTC';
                      setTimeline([
                        ...timeline,
                        {
                          time: nowStr,
                          type: 'RESPONDER_NOTE',
                          message: e.currentTarget.value.trim(),
                        },
                      ]);
                      e.currentTarget.value = '';
                    }
                  }}
                />
                <button className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded text-xs font-semibold flex items-center space-x-1.5">
                  <Send className="w-3.5 h-3.5" />
                  <span>Send</span>
                </button>
              </div>
            </div>
          )}

          {/* TAB 2: Runbooks */}
          {activeTab === 'runbooks' && (
            <div className="grid grid-cols-12 gap-6 max-w-6xl">
              {/* Configuration Column */}
              <div className="col-span-5 space-y-4">
                <div className="p-4 rounded-lg bg-slate-900/70 border border-slate-800 space-y-3">
                  <h3 className="text-xs font-bold uppercase tracking-wider text-slate-300">Runbook Configuration</h3>

                  <div>
                    <label className="text-[11px] text-slate-400 block mb-1">Target Service</label>
                    <input
                      type="text"
                      value={targetService}
                      onChange={(e) => setTargetService(e.target.value)}
                      className="w-full bg-slate-950 border border-slate-700 rounded px-3 py-1.5 text-xs text-slate-100 font-mono"
                    />
                  </div>

                  <div>
                    <label className="text-[11px] text-slate-400 block mb-1">Max Idle Threshold (Seconds)</label>
                    <input
                      type="number"
                      value={maxIdleSeconds}
                      onChange={(e) => setMaxIdleSeconds(Number(e.target.value))}
                      className="w-full bg-slate-950 border border-slate-700 rounded px-3 py-1.5 text-xs text-slate-100 font-mono"
                    />
                  </div>

                  <div className="pt-2 flex items-center justify-between border-t border-slate-800">
                    <span className="text-xs text-slate-300 font-medium">Dry-Run Simulation Mode</span>
                    <input
                      type="checkbox"
                      checked={isDryRun}
                      onChange={(e) => setIsDryRun(e.target.checked)}
                      className="h-4 w-4 rounded border-slate-700 bg-slate-900 text-blue-600 focus:ring-0"
                    />
                  </div>

                  <button
                    onClick={handleRunbookTrigger}
                    disabled={isExecuting}
                    className={`w-full py-2.5 rounded text-xs font-bold flex items-center justify-center space-x-2 transition ${
                      isDryRun
                        ? 'bg-amber-600 hover:bg-amber-500 text-white'
                        : 'bg-red-600 hover:bg-red-500 text-white'
                    }`}
                  >
                    <Play className="w-3.5 h-3.5" />
                    <span>{isDryRun ? 'Simulate Dry-Run Execution' : 'Execute Remediation Runbook'}</span>
                  </button>
                </div>
              </div>

              {/* Execution Console Column */}
              <div className="col-span-7 flex flex-col h-[480px] rounded-lg bg-[#070a0f] border border-slate-800 font-mono text-xs">
                <div className="px-4 py-2.5 border-b border-slate-800/80 bg-slate-900/60 flex items-center justify-between">
                  <div className="flex items-center space-x-2">
                    <Terminal className="w-3.5 h-3.5 text-blue-400" />
                    <span className="text-slate-300 font-semibold text-[11px]">Runner Sandbox Stream (mTLS)</span>
                  </div>
                  <span className="text-[10px] text-emerald-400 bg-emerald-950/60 px-2 py-0.5 rounded border border-emerald-800/60">
                    Runner: Sandboxed
                  </span>
                </div>
                <div className="flex-1 p-4 overflow-y-auto space-y-1.5 text-slate-300">
                  {executionLogs.map((log, idx) => (
                    <div key={idx} className="leading-relaxed">
                      {log.includes('SUCCESS') || log.includes('NOMINAL') ? (
                        <span className="text-emerald-400">{log}</span>
                      ) : log.includes('AUTH') || log.includes('DISPATCH') ? (
                        <span className="text-blue-400">{log}</span>
                      ) : log.includes('DRY_RUN') || log.includes('SIMULATION') ? (
                        <span className="text-amber-400">{log}</span>
                      ) : (
                        log
                      )}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* TAB 3: Telemetry Signals */}
          {activeTab === 'alerts' && (
            <div className="max-w-4xl space-y-4">
              <div className="p-4 rounded-lg bg-slate-900/60 border border-slate-800">
                <h3 className="text-xs font-bold text-slate-200 mb-3 flex items-center space-x-2">
                  <span className="w-2 h-2 rounded-full bg-red-500"></span>
                  <span>Normalized CloudEvent (Prometheus Adapter v1.0)</span>
                </h3>
                <pre className="p-4 bg-slate-950 rounded border border-slate-850 text-[11px] font-mono text-blue-300 overflow-x-auto leading-relaxed">
{JSON.stringify(
  {
    specversion: '1.0',
    id: 'evt_9a4f210e-862d-48e2-9b2f-412e431d0445',
    source: '/monitoring/prometheus/prod-us-east-1',
    type: 'titan.telemetry.alert',
    time: selectedIncident.triggered_at,
    subject: `service/${selectedIncident.service_name}/PostgresPoolSaturated`,
    data: {
      fingerprint: 'a9f84b72e185c0919124430e70ab55f269a9b70b7931f8876c49830113f9c099',
      alertName: 'PostgresPoolSaturated',
      severity: 'CRITICAL',
      service: selectedIncident.service_name,
      environment: selectedIncident.environment,
      summary: selectedIncident.summary,
      metrics: {
        pool_utilization: '96.4%',
        active_connections: 482,
        max_connections: 500,
      },
    },
  },
  null,
  2
)}
                </pre>
              </div>
            </div>
          )}

          {/* TAB 4: Automated Postmortem */}
          {activeTab === 'postmortem' && (
            <div className="max-w-4xl space-y-4">
              <div className="p-6 rounded-lg bg-slate-900/60 border border-slate-800 space-y-4 font-sans text-xs text-slate-200">
                <div className="flex items-center justify-between pb-3 border-b border-slate-800">
                  <h2 className="text-base font-bold text-white">Postmortem: INC-{selectedIncident.incident_number}</h2>
                  <button
                    onClick={() => alert('Postmortem exported to Markdown and synced with issue tracker.')}
                    className="px-3 py-1.5 bg-blue-600 hover:bg-blue-500 text-white rounded text-xs font-semibold"
                  >
                    Export to GitHub / Jira
                  </button>
                </div>
                <div>
                  <h3 className="font-bold text-slate-100 mb-1">Executive Summary</h3>
                  <p className="text-slate-300">{selectedIncident.summary}</p>
                </div>
                <div>
                  <h3 className="font-bold text-slate-100 mb-1">Resilience Metrics</h3>
                  <p className="font-mono text-slate-300">
                    MTTA: &lt; 2 min (Goal: &lt; 2 min) | MTTR: 12 min (Goal: &lt; 18 min) | Ingestion Uptime: 100%
                  </p>
                </div>
                <div>
                  <h3 className="font-bold text-slate-100 mb-1">Preventative Action Items</h3>
                  <ul className="list-disc list-inside space-y-1 text-slate-300">
                    <li>Scale database connection pool baseline configuration.</li>
                    <li>Add query timeout guards on checkout transaction worker pool.</li>
                  </ul>
                </div>
              </div>
            </div>
          )}
        </div>
      </section>

      {/* Dual-Custody Approval Modal */}
      {showApprovalModal && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-[#0f172a] border border-slate-700 rounded-xl max-w-md w-full p-6 shadow-2xl space-y-4">
            <div className="flex items-center space-x-3 text-red-400">
              <AlertTriangle className="w-6 h-6" />
              <h3 className="text-base font-bold text-white">Dual-Custody Authorization Required</h3>
            </div>
            <p className="text-xs text-slate-300 leading-relaxed">
              Runbook <strong className="text-white font-mono">drain-and-scale-db-pool</strong> is marked{' '}
              <strong className="text-red-400 font-mono">requires_approval: true</strong> for P1 production operations.
              Under separation of duties, an Incident Commander must authorize this execution.
            </p>

            <div className="p-3 bg-slate-950 rounded border border-slate-800 text-[11px] font-mono space-y-1 text-slate-400">
              <div>Requester: Sarah Chen (Lead SRE)</div>
              <div>Approver: Alex Vance (Incident Commander)</div>
              <div>Scope: {targetService} (idle &gt; {maxIdleSeconds}s)</div>
            </div>

            <div className="flex items-center justify-end space-x-3 pt-2">
              <button
                onClick={() => setShowApprovalModal(false)}
                className="px-4 py-2 rounded bg-slate-800 hover:bg-slate-700 text-xs font-semibold text-slate-300"
              >
                Cancel
              </button>
              <button
                onClick={() => executeRunbookInternal(false, 'Alex Vance (Incident Commander)')}
                className="px-4 py-2 rounded bg-red-600 hover:bg-red-500 text-xs font-bold text-white shadow-lg shadow-red-600/20"
              >
                Approve & Execute
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
