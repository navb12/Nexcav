import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  LiveTelemetryMessage,
  AlertItem,
  ModelMetrics,
  RetrainingResult,
  FeatureAttribution,
  PumpActuators
} from './types.ts';
import { AnimatedPump } from './components/AnimatedPump.tsx';
import { SensorCard } from './components/SensorCard.tsx';
import { SimulationControls } from './components/SimulationControls.tsx';
import { RiskGauge } from './components/RiskGauge.tsx';
import { AnalyticsPanel } from './components/MLMetricsPanel.tsx';
import { HistoryExportPanel } from './components/HistoryExportPanel.tsx';
import { CriticalAlarmModal } from './components/CriticalAlarmModal.tsx';

export const App: React.FC = () => {
  // Navigation tabs: Minimal 3 sections
  const [activeTab, setActiveTab] = useState<'overview' | 'analytics' | 'history'>('overview');

  // Connection & Telemetry State
  const [connected, setConnected] = useState<boolean>(false);
  const [connError, setConnError] = useState<string | null>(null);
  const [telemetry, setTelemetry] = useState<LiveTelemetryMessage | null>(null);

  // Simulation Controls State
  const [simRunning, setSimRunning] = useState<boolean>(true);
  const [actuators, setActuators] = useState<PumpActuators>({
    suction_restriction: 0,
    bearing_wear: 0,
    discharge_throttling: 0,
    vibration_unbalance: 0
  });

  // Auxiliary Backend Diagnostics
  const [alerts, setAlerts] = useState<AlertItem[]>([]);
  const [metrics, setMetrics] = useState<ModelMetrics | null>(null);
  const [explanation, setExplanation] = useState<{ attributions: FeatureAttribution[]; original_score: number } | null>(null);

  // Real-time sparkline rolling buffers (last 20 readings)
  const [suctionHistory, setSuctionHistory] = useState<number[]>([]);
  const [dischargeHistory, setDischargeHistory] = useState<number[]>([]);
  const [flowHistory, setFlowHistory] = useState<number[]>([]);
  const [vibHistory, setVibHistory] = useState<number[]>([]);
  const [tempHistory, setTempHistory] = useState<number[]>([]);
  const [rpmHistory, setRpmHistory] = useState<number[]>([]);

  const wsRef = useRef<WebSocket | null>(null);

  // Fetch Auxiliary Diagnostics
  const fetchAuxiliaryData = useCallback(async () => {
    try {
      const [alertsRes, metricsRes, explainRes] = await Promise.all([
        fetch('/api/alerts?limit=50'),
        fetch('/api/model/metrics'),
        fetch('/api/model/explain/latest')
      ]);

      if (alertsRes.ok) setAlerts(await alertsRes.json());
      if (metricsRes.ok) setMetrics(await metricsRes.json());
      if (explainRes.ok) setExplanation(await explainRes.json());
      setConnError(null);
    } catch {
      setConnError('Backend server offline. Run: node server.js');
    }
  }, []);

  // WebSocket Telemetry Connection with Automatic Reconnect
  useEffect(() => {
    let reconnectTimer: any = null;
    let isCancelled = false;

    const connectWebSocket = () => {
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const host = window.location.port === '3000' ? '127.0.0.1:8000' : window.location.host;
      const wsUrl = `${protocol}//${host}/ws/live`;

      const socket = new WebSocket(wsUrl);
      wsRef.current = socket;

      socket.onopen = () => {
        if (!isCancelled) {
          setConnected(true);
          setConnError(null);
        }
      };

      socket.onmessage = (event) => {
        if (isCancelled) return;
        try {
          const msg = JSON.parse(event.data);
          if (msg.type === 'reading' || msg.type === 'snapshot') {
            setTelemetry(msg);
            if (msg.running !== undefined) setSimRunning(msg.running);
            if (msg.actuators) setActuators(msg.actuators);

            const r = msg.readings;
            if (r) {
              if (r.suction_pressure !== null) setSuctionHistory((prev) => [...prev.slice(-20), r.suction_pressure]);
              if (r.discharge_pressure !== null) setDischargeHistory((prev) => [...prev.slice(-20), r.discharge_pressure]);
              if (r.flow_rate !== null) setFlowHistory((prev) => [...prev.slice(-20), r.flow_rate]);
              if (r.vibration_rms !== null) setVibHistory((prev) => [...prev.slice(-20), r.vibration_rms]);
              if (r.temperature !== null) setTempHistory((prev) => [...prev.slice(-20), r.temperature]);
              if (r.rpm !== null) setRpmHistory((prev) => [...prev.slice(-20), r.rpm]);
            }
          }
        } catch {
          // ignore malformed packets
        }
      };

      socket.onclose = () => {
        if (!isCancelled) {
          setConnected(false);
          setConnError('Disconnected from live telemetry stream. Retrying connection...');
          reconnectTimer = setTimeout(connectWebSocket, 2500);
        }
      };

      socket.onerror = () => {
        socket.close();
      };
    };

    connectWebSocket();
    fetchAuxiliaryData();

    const interval = setInterval(fetchAuxiliaryData, 4000);

    return () => {
      isCancelled = true;
      clearTimeout(reconnectTimer);
      clearInterval(interval);
      if (wsRef.current) wsRef.current.close();
    };
  }, [fetchAuxiliaryData]);

  // Simulation Controls Integration
  const handleStartSim = async () => {
    try {
      await fetch('/api/sim/start', { method: 'POST' });
      setSimRunning(true);
    } catch {
      setConnError('Failed to send start signal to backend');
    }
  };

  const handlePauseSim = async () => {
    try {
      await fetch('/api/sim/pause', { method: 'POST' });
      setSimRunning(false);
    } catch {
      setConnError('Failed to send pause signal to backend');
    }
  };

  const handleResetSim = async () => {
    try {
      await fetch('/api/sim/reset', { method: 'POST' });
      setSimRunning(false);
      setActuators({ suction_restriction: 0, bearing_wear: 0, discharge_throttling: 0, vibration_unbalance: 0 });
      setSuctionHistory([]);
      setDischargeHistory([]);
      setFlowHistory([]);
      setVibHistory([]);
      setTempHistory([]);
      setRpmHistory([]);
      fetchAuxiliaryData();
    } catch {
      setConnError('Failed to reset simulation');
    }
  };

  const handleActuate = async (actuator: string, delta: number, intensity?: number) => {
    try {
      const res = await fetch('/api/sim/actuate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ actuator, delta, intensity })
      });
      if (res.ok) {
        const data = await res.json();
        if (data.actuators) setActuators(data.actuators);
      }
      fetchAuxiliaryData();
    } catch {
      setConnError('Failed to send physical actuation signal');
    }
  };

  const handleRepairPump = async () => {
    try {
      const res = await fetch('/api/sim/repair', { method: 'POST' });
      if (res.ok) {
        const data = await res.json();
        if (data.actuators) setActuators(data.actuators);
      }
      fetchAuxiliaryData();
    } catch {
      setConnError('Failed to perform equipment repair');
    }
  };

  const handleValidateAlert = async (id: number, classification: string, notes = '') => {
    try {
      await fetch(`/api/alerts/${id}/validate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ classification, notes })
      });
      fetchAuxiliaryData();
    } catch {
      // ignore
    }
  };

  // Alert Action Handlers
  const handleAckAlert = async (id: number) => {
    await fetch(`/api/alerts/${id}/ack`, { method: 'POST' });
    fetchAuxiliaryData();
  };

  const handleResolveAlert = async (id: number) => {
    try {
      await fetch(`/api/alerts/${id}/resolve`, { method: 'POST' });
    } catch {
      // ignore
    }
    fetchAuxiliaryData();
  };

  const handleAcknowledgeAll = async () => {
    const active = alerts.filter(a => a.status === 'active');
    for (const a of active) {
      await fetch(`/api/alerts/${a.id}/ack`, { method: 'POST' });
    }
    fetchAuxiliaryData();
  };

  // ML Retrain Handlers
  const handleRetrain = async (params: { drift: number; future_train_fraction: number }): Promise<RetrainingResult> => {
    const res = await fetch('/api/retraining/run', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...params, label_noise: 0.01 })
    });
    return await res.json();
  };

  const handleDeploy = async (version: string) => {
    await fetch('/api/retraining/deploy', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ version, confirm: true })
    });
    fetchAuxiliaryData();
  };

  const handleExportCsv = () => {
    window.open('/api/history/export', '_blank');
  };

  const handleClearData = async () => {
    await fetch('/api/demo/reset-data?confirm=true', { method: 'POST' });
    fetchAuxiliaryData();
  };

  const currentReadings = telemetry?.readings || {
    suction_pressure: 2.05,
    discharge_pressure: 6.52,
    flow_rate: 100.2,
    vibration_rms: 1.85,
    temperature: 52.5,
    rpm: 2950.0
  };

  const activeAlerts = alerts.filter(a => a.status === 'active');
  const unresolvedAlerts = alerts.filter(a => a.status !== 'resolved');
  const criticalActiveAlert = alerts.find(a => a.severity === 2 && a.status === 'active');

  return (
    <div style={{
      height: '100vh',
      width: '100vw',
      display: 'flex',
      flexDirection: 'column',
      backgroundColor: 'var(--bg-base)',
      overflow: 'hidden'
    }}>
      {/* Proper Critical Alarm Popup Modal (Latching, Stays until Acknowledged or Resolved) */}
      {criticalActiveAlert && (
        <CriticalAlarmModal
          alert={criticalActiveAlert}
          readings={currentReadings}
          onAcknowledge={() => handleAckAlert(criticalActiveAlert.id)}
          onResolve={() => handleResolveAlert(criticalActiveAlert.id)}
          onValidate={(cls) => handleValidateAlert(criticalActiveAlert.id, cls)}
        />
      )}
      {/* 1. Header: NEXCAV, Unit ID, Connection & Navigation */}
      <header style={{
        backgroundColor: 'var(--bg-surface)',
        borderBottom: '1px solid var(--border-subtle)',
        padding: '8px 18px',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        flexShrink: 0
      }}>
        {/* Brand & Small Pump Icon */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <div style={{
            width: '28px',
            height: '28px',
            borderRadius: '4px',
            backgroundColor: 'var(--bg-surface-elevated)',
            border: '1px solid var(--border-medium)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            flexShrink: 0
          }}>
            <svg
              width="20"
              height="20"
              viewBox="0 0 24 24"
              fill="none"
              stroke="var(--accent-cyan)"
              strokeLinecap="round"
              strokeLinejoin="round"
              style={{ display: 'block' }}
            >
              {/* Discharge nozzle & top flange */}
              <line x1="13" y1="3" x2="21" y2="3" strokeWidth="1.8" />
              <path d="M15 3v5" strokeWidth="1.6" />
              <path d="M19 3v8" strokeWidth="1.6" />

              {/* Pump volute casing */}
              <circle cx="12" cy="13.5" r="7.2" strokeWidth="1.6" fill="rgba(56, 189, 248, 0.08)" />

              {/* Suction inlet nozzle on left */}
              <path d="M2.5 11.5h2.5v4H2.5" strokeWidth="1.5" />

              {/* Center impeller hub & eye */}
              <circle cx="12" cy="13.5" r="2.8" strokeWidth="1.5" fill="var(--bg-surface-elevated)" />
              <circle cx="12" cy="13.5" r="1.1" fill="var(--accent-cyan)" stroke="none" />

              {/* Impeller vane ticks */}
              <line x1="12" y1="8.2" x2="12" y2="9.6" strokeWidth="1.3" />
              <line x1="12" y1="17.4" x2="12" y2="18.8" strokeWidth="1.3" />
              <line x1="6.8" y1="13.5" x2="8.2" y2="13.5" strokeWidth="1.3" />
              <line x1="15.8" y1="13.5" x2="17.2" y2="13.5" strokeWidth="1.3" />
            </svg>
          </div>
          <h1 style={{ fontSize: '17px', fontWeight: 800, color: 'var(--text-primary)', letterSpacing: '0.8px', margin: 0 }}>
            NEXCAV
          </h1>
        </div>

        {/* Connection Indicator */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
          {/* Connection Status Badge */}
          <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
            fontSize: '12px',
            fontFamily: 'monospace',
            fontWeight: 700,
            color: connected ? 'var(--status-normal)' : 'var(--status-critical)'
          }}>
            <span style={{
              width: '7px',
              height: '7px',
              borderRadius: '50%',
              backgroundColor: connected ? 'var(--status-normal)' : 'var(--status-critical)'
            }} />
            <span>{connected ? 'ONLINE (127.0.0.1:8000)' : 'OFFLINE'}</span>
          </div>
        </div>

        {/* Minimal Navigation: Overview | Analytics | History */}
        <nav style={{ display: 'flex', gap: '4px', backgroundColor: 'var(--bg-surface-subtle)', padding: '3px', borderRadius: '4px', border: '1px solid var(--border-subtle)' }}>
          {[
            { id: 'overview', label: 'Overview' },
            { id: 'analytics', label: 'Diagnostics & ML' },
            { id: 'history', label: `Alarms & History (${unresolvedAlerts.length})` }
          ].map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id as any)}
              style={{
                backgroundColor: activeTab === tab.id ? 'var(--bg-surface-elevated)' : 'transparent',
                color: activeTab === tab.id ? 'var(--accent-cyan)' : 'var(--text-secondary)',
                border: activeTab === tab.id ? '1px solid var(--border-medium)' : '1px solid transparent',
                padding: '5px 12px',
                borderRadius: '3px',
                fontSize: '12px',
                fontWeight: activeTab === tab.id ? 700 : 500,
                cursor: 'pointer'
              }}
            >
              {tab.label}
            </button>
          ))}
        </nav>
      </header>

      {/* Connection Warning Banner */}
      {connError && (
        <div style={{
          backgroundColor: 'rgba(239, 68, 68, 0.12)',
          borderBottom: '1px solid var(--status-critical)',
          padding: '6px 20px',
          fontSize: '11px',
          color: 'var(--status-critical)',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center'
        }}>
          <span>⚠ {connError}</span>
          <span style={{ fontSize: '10.5px', color: 'var(--text-muted)' }}>
            Start backend with: <code>node server.js</code>
          </span>
        </div>
      )}

      {/* Main Screen Container */}
      <main style={{
        flex: 1,
        padding: '8px 18px',
        display: 'flex',
        flexDirection: 'column',
        gap: '8px',
        maxWidth: '100%',
        width: '100%',
        margin: '0 auto',
        minHeight: 0,
        overflow: activeTab === 'overview' ? 'hidden' : 'auto',
        boxSizing: 'border-box'
      }}>
        {/* Streamlined Industrial Simulation Controls Bar */}
        <SimulationControls
          running={simRunning}
          simTime={telemetry?.sim_t ?? 0}
          actuators={actuators}
          onStart={handleStartSim}
          onPause={handlePauseSim}
          onReset={handleResetSim}
          onActuate={handleActuate}
          onRepairPump={handleRepairPump}
        />

        {/* Tab 1: Overview (Main Visual Focus) */}
        {activeTab === 'overview' && (
          <div style={{
            display: 'flex',
            flexDirection: 'column',
            gap: '8px',
            flex: 1,
            minHeight: 0,
            overflow: 'hidden'
          }}>
            {/* Top Row: Pump Animation (Left, Smaller) & Telemetry Area (Right, 6 Cards in 3x2 Grid) */}
            <div style={{
              display: 'grid',
              gridTemplateColumns: 'minmax(280px, 0.9fr) minmax(560px, 2.1fr)',
              gap: '8px',
              flex: 1,
              minHeight: 0
            }}>
              {/* 1. Pump Animation Area (Smaller, Simplified) */}
              <AnimatedPump
                rpm={currentReadings.rpm}
                vibration={currentReadings.vibration_rms}
                severity={telemetry?.scenario_severity ?? 0.05}
                status={telemetry?.status || 'Normal Operation'}
                running={simRunning}
              />

              {/* 2. Telemetry Area: 6 Sensors in 3 Columns x 2 Rows */}
              <div style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(3, 1fr)',
                gridTemplateRows: 'repeat(2, 1fr)',
                gap: '8px',
                height: '100%',
                minHeight: 0
              }}>
                <SensorCard
                  label="Suction Pressure"
                  value={currentReadings.suction_pressure}
                  unit="bar"
                  nominal={2.05}
                  history={suctionHistory}
                  warningLimit={1.20}
                  alarmLimit={0.80}
                  operator="<"
                />
                <SensorCard
                  label="Discharge Pressure"
                  value={currentReadings.discharge_pressure}
                  unit="bar"
                  nominal={6.52}
                  history={dischargeHistory}
                  warningLimit={5.00}
                  alarmLimit={4.00}
                  operator="<"
                />
                <SensorCard
                  label="Water Flow Rate"
                  value={currentReadings.flow_rate}
                  unit="m³/h"
                  nominal={100.2}
                  history={flowHistory}
                  warningLimit={75.0}
                  alarmLimit={60.0}
                  operator="<"
                />
                <SensorCard
                  label="Pump Vibration"
                  value={currentReadings.vibration_rms}
                  unit="mm/s"
                  nominal={1.85}
                  history={vibHistory}
                  warningLimit={4.50}
                  alarmLimit={7.00}
                  operator=">"
                />
                <SensorCard
                  label="Bearing Temperature"
                  value={currentReadings.temperature}
                  unit="°C"
                  nominal={52.5}
                  history={tempHistory}
                  warningLimit={70.0}
                  alarmLimit={80.0}
                  operator=">"
                />
                <SensorCard
                  label="Shaft Speed"
                  value={currentReadings.rpm}
                  unit="RPM"
                  nominal={2950}
                  decimals={0}
                  history={rpmHistory}
                />
              </div>
            </div>

            {/* Persistent Active Alarms List Bar on Overview */}
            {unresolvedAlerts.length > 0 && (
              <div style={{
                backgroundColor: 'var(--bg-surface)',
                border: '1px solid var(--border-subtle)',
                borderRadius: '4px',
                padding: '6px 12px',
                flexShrink: 0
              }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '4px' }}>
                  <span style={{ fontSize: '11.5px', fontWeight: 700, color: 'var(--text-secondary)', textTransform: 'uppercase' }}>
                    Active Alarms & Diagnostic Notifications ({unresolvedAlerts.length})
                  </span>
                  {activeAlerts.length > 0 && (
                    <button
                      onClick={handleAcknowledgeAll}
                      style={{
                        backgroundColor: 'var(--bg-surface-elevated)',
                        color: 'var(--status-warning)',
                        border: '1px solid var(--border-medium)',
                        padding: '2px 8px',
                        borderRadius: '3px',
                        fontSize: '11px',
                        fontWeight: 700,
                        cursor: 'pointer'
                      }}
                    >
                      Acknowledge All ({activeAlerts.length})
                    </button>
                  )}
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', maxHeight: '110px', overflowY: 'auto' }}>
                  {unresolvedAlerts.map((a) => {
                    const isCrit = a.severity === 2;
                    const isAck = a.status === 'acknowledged';
                    return (
                      <div
                        key={a.id}
                        style={{
                          display: 'flex',
                          justifyContent: 'space-between',
                          alignItems: 'center',
                          backgroundColor: 'var(--bg-surface-subtle)',
                          borderLeft: `3px solid ${isCrit ? 'var(--status-critical)' : 'var(--status-warning)'}`,
                          padding: '4px 10px',
                          borderRadius: '2px',
                          fontSize: '12px'
                        }}
                      >
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                          <span style={{
                            fontSize: '10.5px',
                            fontWeight: 800,
                            fontFamily: 'monospace',
                            color: isCrit ? 'var(--status-critical)' : 'var(--status-warning)'
                          }}>
                            {isAck ? '[ACKNOWLEDGED]' : isCrit ? '[CRITICAL ALARM]' : '[WARNING]'}
                          </span>
                          <span style={{ color: 'var(--text-primary)', fontWeight: 700 }}>
                            {a.category}
                          </span>
                          <span style={{ color: 'var(--text-secondary)', fontSize: '11.5px' }}>
                            — {a.explanation}
                          </span>
                        </div>

                        <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
                          <button
                            onClick={() => handleValidateAlert(a.id, 'confirmed_cavitation')}
                            style={{
                              backgroundColor: 'transparent',
                              color: 'var(--status-normal)',
                              border: '1px dashed var(--border-subtle)',
                              padding: '2px 6px',
                              borderRadius: '2px',
                              fontSize: '10px',
                              cursor: 'pointer'
                            }}
                            title="Confirm genuine cavitation detection"
                          >
                            ✓ Confirm
                          </button>
                          <button
                            onClick={() => handleValidateAlert(a.id, 'false_positive')}
                            style={{
                              backgroundColor: 'transparent',
                              color: 'var(--status-critical)',
                              border: '1px dashed var(--border-subtle)',
                              padding: '2px 6px',
                              borderRadius: '2px',
                              fontSize: '10px',
                              cursor: 'pointer'
                            }}
                            title="Classify as false positive"
                          >
                            ✗ FP
                          </button>
                          {!isAck && (
                            <button
                              onClick={() => handleAckAlert(a.id)}
                              style={{
                                backgroundColor: 'transparent',
                                color: 'var(--status-warning)',
                                border: '1px solid var(--border-subtle)',
                                padding: '2px 8px',
                                borderRadius: '2px',
                                fontSize: '11px',
                                fontWeight: 600,
                                cursor: 'pointer'
                              }}
                            >
                              Ack
                            </button>
                          )}
                          <button
                            onClick={() => handleResolveAlert(a.id)}
                            style={{
                              backgroundColor: 'transparent',
                              color: 'var(--status-normal)',
                              border: '1px solid var(--border-subtle)',
                              padding: '2px 8px',
                              borderRadius: '2px',
                              fontSize: '11px',
                              fontWeight: 600,
                              cursor: 'pointer'
                            }}
                          >
                            Resolve
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* 3. Diagnostic Area: Switched to Bottom */}
            <RiskGauge
              score={telemetry?.prediction?.model_score ?? 0.05}
              riskLevel={telemetry?.prediction?.risk_level ?? 0}
              status={telemetry?.prediction?.predicted_class || telemetry?.status || 'Normal Operation'}
              trajectory={telemetry?.prediction?.trajectory || 'Stable'}
              riskVelocity={telemetry?.prediction?.risk_velocity_per_min || 0}
              sequenceFeatures={telemetry?.prediction?.sequence_features}
              predictionHistory={telemetry?.prediction_history || []}
              modelVersion={telemetry?.prediction?.model_version || 'v2.1.0-timeseries'}
              breaches={telemetry?.threshold_breaches || []}
              attributions={telemetry?.prediction?.attributions || explanation?.attributions || []}
              activeAlertCount={activeAlerts.length}
              onAcknowledgeAll={handleAcknowledgeAll}
            />
          </div>
        )}

        {/* Tab 2: Analytics & Model Sensitivity */}
        {activeTab === 'analytics' && (
          <AnalyticsPanel
            metrics={metrics}
            latestExplanation={explanation}
            onRetrain={handleRetrain}
            onDeploy={handleDeploy}
          />
        )}

        {/* Tab 3: History & Alarms */}
        {activeTab === 'history' && (
          <HistoryExportPanel
            alerts={alerts}
            onAcknowledgeAlert={handleAckAlert}
            onResolveAlert={handleResolveAlert}
            onExportCsv={handleExportCsv}
            onClearData={handleClearData}
            onRefreshAlerts={fetchAuxiliaryData}
          />
        )}
      </main>
    </div>
  );
};
