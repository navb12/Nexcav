import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  LiveTelemetryMessage,
  AlertItem,
  ModelMetrics,
  RetrainingResult,
  FeatureAttribution,
  PumpActuators
} from './types.ts';
import { PumpSchematic } from './components/PumpSchematic.tsx';
import { CavitationProbabilityChart } from './components/CavitationProbabilityChart.tsx';
import { AnalyticsPanel } from './components/MLMetricsPanel.tsx';
import { HistoryExportPanel } from './components/HistoryExportPanel.tsx';
import { CriticalAlarmModal } from './components/CriticalAlarmModal.tsx';

// Severity Stage Cutoffs (Configurable in one named constant)
export const SEVERITY_THRESHOLDS = {
  normal: 0.25,     // Below 25%: Normal
  incipient: 0.50,  // 25% to 50%: Incipient
  developed: 0.80   // 50% to 80%: Developed, Above 80%: Severe
} as const;

export function getSeverityStage(prob: number): 'Normal' | 'Incipient' | 'Developed' | 'Severe' {
  if (prob < SEVERITY_THRESHOLDS.normal) return 'Normal';
  if (prob < SEVERITY_THRESHOLDS.incipient) return 'Incipient';
  if (prob < SEVERITY_THRESHOLDS.developed) return 'Developed';
  return 'Severe';
}

// Stage color: neutral for Normal, then single accent color increasing in strength
export function getSeverityColor(stage: 'Normal' | 'Incipient' | 'Developed' | 'Severe'): string {
  switch (stage) {
    case 'Normal':
      return '#94a3b8'; // Neutral slate
    case 'Incipient':
      return 'rgba(56, 189, 248, 0.70)'; // Accent blue at 70% intensity
    case 'Developed':
      return '#38bdf8'; // Full accent blue
    case 'Severe':
      return '#60a5fa'; // Strong bright accent blue
  }
}

export const App: React.FC = () => {
  // Navigation tabs: Live (matching user design) | Model... | History
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

  // Controls UI state matching the design
  const [selectedFault, setSelectedFault] = useState<string>('suction_restriction');
  const [faultSeverity, setFaultSeverity] = useState<number>(35); // Matches "35 %" in design
  const [faultActive, setFaultActive] = useState<boolean>(false);

  // Auxiliary Backend Diagnostics
  const [alerts, setAlerts] = useState<AlertItem[]>([]);
  const [metrics, setMetrics] = useState<ModelMetrics | null>(null);
  const [explanation, setExplanation] = useState<{ attributions: FeatureAttribution[]; original_score: number } | null>(null);

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
            if (msg.actuators) {
              setActuators(msg.actuators);
              const suctAct = msg.actuators.suction_restriction || 0;
              const brgAct = msg.actuators.bearing_wear || 0;
              const discAct = msg.actuators.discharge_throttling || 0;
              if (suctAct > 0 || brgAct > 0 || discAct > 0) {
                setFaultActive(true);
              }
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

  // Physical Actuation Handlers
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

  const handleInjectCurrentFault = () => {
    handleActuate(selectedFault, 0, faultSeverity / 100);
    setFaultActive(true);
  };

  const handleResetFault = () => {
    handleRepairPump();
    setFaultSeverity(0);
    setFaultActive(false);
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
    suction_pressure: 0.42,
    discharge_pressure: 4.10,
    flow_rate: 38.2,
    vibration_rms: 6.80,
    temperature: 58.0,
    rpm: 2930.0,
    motor_current: 11.9
  };

  const prob = telemetry?.prediction?.model_score ?? (faultActive ? 0.78 : 0.05);
  const severityStage = getSeverityStage(prob);
  const severityColor = getSeverityColor(severityStage);
  const criticalActiveAlert = alerts.find(a => a.severity === 2 && a.status === 'active');
  const activeDegradation = Object.values(actuators).some(v => v > 0);

  return (
    <div style={{
      height: '100vh',
      width: '100vw',
      display: 'flex',
      flexDirection: 'column',
      backgroundColor: '#0d1117',
      color: '#f8fafc',
      fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
      overflow: 'hidden'
    }}>
      {/* Critical Alarm Modal */}
      {criticalActiveAlert && (
        <CriticalAlarmModal
          alert={criticalActiveAlert}
          readings={currentReadings}
          onAcknowledge={() => handleAckAlert(criticalActiveAlert.id)}
          onResolve={() => handleResolveAlert(criticalActiveAlert.id)}
          onValidate={(cls) => handleValidateAlert(criticalActiveAlert.id, cls)}
        />
      )}

      {/* 1. Top Bar: "NexCav Pump P-101 cavitation monitor" + Navigation ("Live", "Model...") */}
      <header style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        padding: '10px 24px',
        backgroundColor: '#0d1117',
        borderBottom: '1px solid #1e293b',
        flexShrink: 0
      }}>
        {/* Title */}
        <div style={{ display: 'flex', alignItems: 'baseline', gap: '12px' }}>
          <span style={{ fontSize: '18px', fontWeight: 800, color: '#f8fafc', letterSpacing: '0.2px' }}>
            NexCav
          </span>
          <span style={{ fontSize: '14px', color: '#94a3b8', fontWeight: 400 }}>
            Pump P-101 cavitation monitor
          </span>
        </div>

        {/* Top-Right Navigation Tabs */}
        <nav style={{ display: 'flex', gap: '22px', alignItems: 'center' }}>
          <button
            onClick={() => setActiveTab('overview')}
            style={{
              background: 'none',
              border: 'none',
              color: activeTab === 'overview' ? '#f8fafc' : '#94a3b8',
              fontWeight: activeTab === 'overview' ? 700 : 500,
              fontSize: '14px',
              paddingBottom: '3px',
              borderBottom: activeTab === 'overview' ? '2.5px solid #38bdf8' : '2.5px solid transparent',
              cursor: 'pointer'
            }}
          >
            Live
          </button>

          <button
            onClick={() => setActiveTab('analytics')}
            style={{
              background: 'none',
              border: 'none',
              color: activeTab === 'analytics' ? '#f8fafc' : '#94a3b8',
              fontWeight: activeTab === 'analytics' ? 700 : 500,
              fontSize: '14px',
              paddingBottom: '3px',
              borderBottom: activeTab === 'analytics' ? '2.5px solid #38bdf8' : '2.5px solid transparent',
              cursor: 'pointer'
            }}
          >
            Model...
          </button>

          <button
            onClick={() => setActiveTab('history')}
            style={{
              background: 'none',
              border: 'none',
              color: activeTab === 'history' ? '#f8fafc' : '#94a3b8',
              fontWeight: activeTab === 'history' ? 700 : 500,
              fontSize: '14px',
              paddingBottom: '3px',
              borderBottom: activeTab === 'history' ? '2.5px solid #38bdf8' : '2.5px solid transparent',
              cursor: 'pointer'
            }}
          >
            History
          </button>
        </nav>
      </header>

      {/* Connection Offline Alert Banner (Only if disconnected) */}
      {connError && (
        <div style={{
          backgroundColor: 'rgba(239, 68, 68, 0.12)',
          borderBottom: '1px solid #ef4444',
          padding: '4px 24px',
          fontSize: '11px',
          color: '#ef4444',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center'
        }}>
          <span>⚠ {connError}</span>
          <span style={{ fontSize: '10.5px', color: '#94a3b8' }}>Run: <code>node server.js</code></span>
        </div>
      )}

      {/* 2. Sub-Header: "Replay: test_run_07.csv" (Left) + "Developed cavitation P = 78 %" (Right) */}
      <div style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        padding: '10px 24px 6px',
        backgroundColor: '#0d1117',
        flexShrink: 0
      }}>
        <div style={{
          color: '#94a3b8',
          fontFamily: 'monospace',
          fontSize: '13px',
          letterSpacing: '0.2px',
          display: 'flex',
          alignItems: 'center',
          gap: '8px'
        }}>
          <span
            style={{
              width: '6px',
              height: '6px',
              borderRadius: '50%',
              backgroundColor: connected ? '#10b981' : '#ef4444',
              display: 'inline-block'
            }}
            title={connected ? 'Live WebSocket connected' : 'WebSocket connecting or offline'}
          />
          <span>Replay: test_run_07.csv</span>
          {activeDegradation && (
            <span style={{ fontSize: '11px', color: '#f59e0b', fontWeight: 600 }}>
              (fault active)
            </span>
          )}
        </div>

        <div style={{
          fontSize: '15px',
          fontWeight: 700,
          color: severityColor,
          fontFamily: '-apple-system, BlinkMacSystemFont, sans-serif',
          letterSpacing: '0.3px'
        }}>
          {severityStage}  P = {Math.round(prob * 100)} %
        </div>
      </div>

      {/* 3. Main Dashboard View (Left Column + Right Chart) */}
      {activeTab === 'overview' && (
        <main style={{
          display: 'grid',
          gridTemplateColumns: '270px 1fr',
          flex: 1,
          minHeight: 0,
          backgroundColor: '#0d1117',
          padding: '0 24px',
          gap: '24px',
          overflow: 'hidden'
        }}>
          {/* Left Column: Pump Schematic + Fault Controls */}
          <div style={{
            display: 'flex',
            flexDirection: 'column',
            borderRight: '1px solid #1e293b',
            paddingRight: '22px',
            gap: '12px',
            justifyContent: 'flex-start'
          }}>
            {/* Pump Diagram */}
            <PumpSchematic
              rpm={currentReadings.rpm || 2950}
              running={simRunning}
              probability={prob}
              severityStage={severityStage}
            />

            {/* Controls Section */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '14px', marginTop: '2px' }}>
              {/* Fault type */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                <label style={{ fontSize: '13px', color: '#94a3b8', fontWeight: 500 }}>
                  Fault type
                </label>
                <select
                  value={selectedFault}
                  onChange={(e) => setSelectedFault(e.target.value)}
                  style={{
                    backgroundColor: '#111827',
                    color: '#f8fafc',
                    border: '1px solid #334155',
                    borderRadius: '6px',
                    padding: '8px 12px',
                    fontSize: '13px',
                    outline: 'none',
                    cursor: 'pointer'
                  }}
                >
                  <option value="suction_restriction">Suction restriction</option>
                  <option value="bearing_wear">Bearing wear</option>
                  <option value="discharge_throttling">Discharge throttling</option>
                  <option value="vibration_unbalance">Rotor unbalance</option>
                </select>
              </div>

              {/* Fault severity */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                <label style={{ fontSize: '13px', color: '#94a3b8', fontWeight: 500 }}>
                  Fault severity
                </label>
                <div style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  backgroundColor: '#111827',
                  border: '1px solid #334155',
                  borderRadius: '6px',
                  padding: '4px 8px',
                  width: '150px'
                }}>
                  <button
                    onClick={() => setFaultSeverity((prev) => Math.max(0, prev - 10))}
                    style={{
                      background: 'none',
                      border: 'none',
                      color: '#cbd5e1',
                      fontSize: '16px',
                      fontWeight: 700,
                      cursor: 'pointer',
                      padding: '2px 8px'
                    }}
                  >
                    -
                  </button>
                  <span style={{ fontSize: '14px', fontWeight: 700, color: '#f8fafc', fontFamily: 'monospace' }}>
                    {faultSeverity} %
                  </span>
                  <button
                    onClick={() => setFaultSeverity((prev) => Math.min(100, prev + 10))}
                    style={{
                      background: 'none',
                      border: 'none',
                      color: '#cbd5e1',
                      fontSize: '16px',
                      fontWeight: 700,
                      cursor: 'pointer',
                      padding: '2px 8px'
                    }}
                  >
                    +
                  </button>
                </div>
              </div>

              {/* Action Buttons: Inject & Reset */}
              <div style={{ display: 'flex', gap: '10px', marginTop: '6px' }}>
                <button
                  onClick={handleInjectCurrentFault}
                  style={{
                    flex: 1,
                    backgroundColor: '#111827',
                    color: '#f8fafc',
                    border: '1px solid #334155',
                    borderRadius: '6px',
                    padding: '8px 16px',
                    fontSize: '13px',
                    fontWeight: 600,
                    cursor: 'pointer',
                    transition: 'all 0.15s ease'
                  }}
                  title="Apply fault condition to simulated pump"
                >
                  Inject
                </button>
                <button
                  onClick={handleResetFault}
                  style={{
                    flex: 1,
                    backgroundColor: '#111827',
                    color: '#cbd5e1',
                    border: '1px solid #334155',
                    borderRadius: '6px',
                    padding: '8px 16px',
                    fontSize: '13px',
                    fontWeight: 600,
                    cursor: 'pointer',
                    transition: 'all 0.15s ease'
                  }}
                  title="Reset pump to nominal healthy state"
                >
                  Reset
                </button>
              </div>
            </div>
          </div>

          {/* Right Column: Main Cavitation Probability Chart */}
          <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
            <CavitationProbabilityChart
              currentProbability={prob}
              history={telemetry?.prediction_history || []}
              faultSeverityPercent={faultSeverity}
              faultActive={faultActive}
            />
          </div>
        </main>
      )}

      {/* Model & Diagnostics Tab */}
      {activeTab === 'analytics' && (
        <main style={{ flex: 1, padding: '16px 24px', overflowY: 'auto' }}>
          <AnalyticsPanel
            metrics={metrics}
            latestExplanation={explanation}
            onRetrain={handleRetrain}
            onDeploy={handleDeploy}
          />
        </main>
      )}

      {/* Alarms & History Tab */}
      {activeTab === 'history' && (
        <main style={{ flex: 1, padding: '16px 24px', overflowY: 'auto' }}>
          <HistoryExportPanel
            alerts={alerts}
            onAcknowledgeAlert={handleAckAlert}
            onResolveAlert={handleResolveAlert}
            onExportCsv={handleExportCsv}
            onClearData={handleClearData}
            onRefreshAlerts={fetchAuxiliaryData}
          />
        </main>
      )}

      {/* 4. Bottom Telemetry Bar: 6 Measurements in exact layout */}
      <footer style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(6, 1fr)',
        backgroundColor: '#0d1117',
        borderTop: '1px solid #1e293b',
        padding: '12px 0',
        flexShrink: 0
      }}>
        {/* 1. Suction press. */}
        <div style={{ padding: '0 24px', borderRight: '1px solid #1e293b' }}>
          <div style={{ fontSize: '12px', color: '#94a3b8', marginBottom: '3px' }}>
            Suction press.
          </div>
          <div style={{ fontSize: '16px', fontWeight: 700, color: '#f8fafc', fontFamily: 'monospace' }}>
            {currentReadings.suction_pressure !== null ? currentReadings.suction_pressure.toFixed(2) : '0.42'}{' '}
            <span style={{ fontSize: '12px', fontWeight: 400, color: '#94a3b8' }}>bar</span>
          </div>
        </div>

        {/* 2. Discharge press. */}
        <div style={{ padding: '0 24px', borderRight: '1px solid #1e293b' }}>
          <div style={{ fontSize: '12px', color: '#94a3b8', marginBottom: '3px' }}>
            Discharge press.
          </div>
          <div style={{ fontSize: '16px', fontWeight: 700, color: '#f8fafc', fontFamily: 'monospace' }}>
            {currentReadings.discharge_pressure !== null ? currentReadings.discharge_pressure.toFixed(2) : '4.10'}{' '}
            <span style={{ fontSize: '12px', fontWeight: 400, color: '#94a3b8' }}>bar</span>
          </div>
        </div>

        {/* 3. Flow */}
        <div style={{ padding: '0 24px', borderRight: '1px solid #1e293b' }}>
          <div style={{ fontSize: '12px', color: '#94a3b8', marginBottom: '3px' }}>
            Flow
          </div>
          <div style={{ fontSize: '16px', fontWeight: 700, color: '#f8fafc', fontFamily: 'monospace' }}>
            {currentReadings.flow_rate !== null ? currentReadings.flow_rate.toFixed(1) : '38.2'}{' '}
            <span style={{ fontSize: '12px', fontWeight: 400, color: '#94a3b8' }}>m3/h</span>
          </div>
        </div>

        {/* 4. Vibration RMS */}
        <div style={{ padding: '0 24px', borderRight: '1px solid #1e293b' }}>
          <div style={{ fontSize: '12px', color: '#94a3b8', marginBottom: '3px' }}>
            Vibration RMS
          </div>
          <div style={{ fontSize: '16px', fontWeight: 700, color: '#f8fafc', fontFamily: 'monospace' }}>
            {currentReadings.vibration_rms !== null ? currentReadings.vibration_rms.toFixed(1) : '6.8'}{' '}
            <span style={{ fontSize: '12px', fontWeight: 400, color: '#94a3b8' }}>mm/s</span>
          </div>
        </div>

        {/* 5. Motor current */}
        <div style={{ padding: '0 24px', borderRight: '1px solid #1e293b' }}>
          <div style={{ fontSize: '12px', color: '#94a3b8', marginBottom: '3px' }}>
            Motor current
          </div>
          <div style={{ fontSize: '16px', fontWeight: 700, color: '#f8fafc', fontFamily: 'monospace' }}>
            {currentReadings.motor_current !== undefined && currentReadings.motor_current !== null
              ? currentReadings.motor_current.toFixed(1)
              : '11.9'}{' '}
            <span style={{ fontSize: '12px', fontWeight: 400, color: '#94a3b8' }}>A</span>
          </div>
        </div>

        {/* 6. Temperature */}
        <div style={{ padding: '0 24px' }}>
          <div style={{ fontSize: '12px', color: '#94a3b8', marginBottom: '3px' }}>
            Temperature
          </div>
          <div style={{ fontSize: '16px', fontWeight: 700, color: '#f8fafc', fontFamily: 'monospace' }}>
            {currentReadings.temperature !== null ? currentReadings.temperature.toFixed(0) : '58'}{' '}
            <span style={{ fontSize: '12px', fontWeight: 400, color: '#94a3b8' }}>degC</span>
          </div>
        </div>
      </footer>
    </div>
  );
};
