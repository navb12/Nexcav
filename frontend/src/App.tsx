import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import {
  LiveTelemetryMessage,
  AlertItem,
  ModelMetrics,
  PumpActuators,
  ReplayRunItem
} from './types.ts';
import { PumpSchematic } from './components/PumpSchematic.tsx';
import { CavitationProbabilityChart, CORRECTIVE_ACTIONS, WARN_PROB, DETECT_PROB } from './components/CavitationProbabilityChart.tsx';
import { AnalyticsPanel } from './components/MLMetricsPanel.tsx';
import { DataMethodPanel } from './components/DataMethodPanel.tsx';
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
  // Navigation tabs: Live | Model | Data and method (renamed from History)
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

  // Phase 2 Independent Multiple Faults State (starting at 0%, independent controls)
  const [faultSeverities, setFaultSeverities] = useState<Record<string, number>>({
    suction_restriction: 0,
    discharge_throttling: 0,
    bearing_wear: 0,
    vibration_unbalance: 0
  });
  const [faultActive, setFaultActive] = useState<boolean>(false);

  // Phase 3 Early Warning & Detection Popups State
  const [earlyWarnActive, setEarlyWarnActive] = useState(false);
  const [detectedActive, setDetectedActive] = useState(false);
  const [earlyWarnDismissed, setEarlyWarnDismissed] = useState(false);
  const [detectedDismissed, setDetectedDismissed] = useState(false);
  const [warnEpisodeArmed, setWarnEpisodeArmed] = useState(true);
  const [detectedEpisodeArmed, setDetectedEpisodeArmed] = useState(true);
  const [warnTime, setWarnTime] = useState<number | null>(null);
  const [detectTime, setDetectTime] = useState<number | null>(null);
  const [earlyWarnAlertId, setEarlyWarnAlertId] = useState<string>('');
  const [detectedAlertId, setDetectedAlertId] = useState<string>('');

  // Mode & Replay State
  const [mode, setMode] = useState<'manual' | 'replay'>('manual');
  const [replayRuns, setReplayRuns] = useState<ReplayRunItem[]>([]);
  const [selectedRunId, setSelectedRunId] = useState<string>('');
  const [replayState, setReplayState] = useState<'idle' | 'playing' | 'paused' | 'complete'>('idle');
  const [replayProgress, setReplayProgress] = useState<{ current: number; total: number }>({ current: 0, total: 60 });

  // Auxiliary Backend Diagnostics
  const [alerts, setAlerts] = useState<AlertItem[]>([]);
  const [metrics, setMetrics] = useState<ModelMetrics | null>(null);

  const wsRef = useRef<WebSocket | null>(null);

  // Fetch Auxiliary Diagnostics
  const fetchAuxiliaryData = useCallback(async () => {
    try {
      const [alertsRes, metricsRes] = await Promise.all([
        fetch('/api/alerts?limit=50'),
        fetch('/api/model/metrics')
      ]);

      if (alertsRes.ok) setAlerts(await alertsRes.json());
      if (metricsRes.ok) setMetrics(await metricsRes.json());
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
            if (msg.mode) setMode(msg.mode);
            if (msg.replay_state) setReplayState(msg.replay_state);
            if (msg.replay_run_id) setSelectedRunId(msg.replay_run_id);
            if (msg.replay_progress) setReplayProgress(msg.replay_progress);
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

  // Phase 2: Independent Fault Control Handlers
  const handleAdjustFault = (id: string, delta: number) => {
    setFaultSeverities((prev) => {
      const nextVal = Math.max(0, Math.min(100, (prev[id] || 0) + delta));
      const nextObj = { ...prev, [id]: nextVal };
      handleActuate(id, 0, nextVal / 100);
      const anyActive = Object.values(nextObj).some(v => v > 0);
      setFaultActive(anyActive);
      return nextObj;
    });
  };

  const handleResetFault = () => {
    handleRepairPump();
    setFaultSeverities({
      suction_restriction: 0,
      discharge_throttling: 0,
      bearing_wear: 0,
      vibration_unbalance: 0
    });
    setFaultActive(false);
    setEarlyWarnActive(false);
    setDetectedActive(false);
    setEarlyWarnDismissed(false);
    setDetectedDismissed(false);
    setWarnEpisodeArmed(true);
    setDetectedEpisodeArmed(true);
  };

  // Feedback Verdict Handler for Alert Popups & Modals
  const handleAlertVerdict = async (alertId: string, verdict: 'acknowledged' | 'correct' | 'false_alarm', type: 'warning' | 'detected') => {
    if (type === 'warning') {
      setEarlyWarnDismissed(true);
    } else {
      setDetectedDismissed(true);
    }

    try {
      await fetch('/api/feedback/log', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          alert_id: alertId,
          verdict
        })
      });
      fetchAuxiliaryData();
    } catch {}
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

  // Replay CSV Handlers
  useEffect(() => {
    fetch('/api/replay/runs')
      .then(res => res.json())
      .then((runs: ReplayRunItem[]) => {
        if (Array.isArray(runs) && runs.length > 0) {
          setReplayRuns(runs);
          setSelectedRunId(runs[0].run_id);
        }
      })
      .catch(() => {});
  }, []);

  const handleToggleMode = async (newMode: 'manual' | 'replay') => {
    setMode(newMode);
    try {
      const res = await fetch('/api/sim/mode', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode: newMode })
      });
      if (res.ok) {
        const d = await res.json();
        setReplayState(d.replay_state || 'idle');
        if (d.replay_run_id) setSelectedRunId(d.replay_run_id);
      }
    } catch {}
  };

  const handleSelectRun = async (runId: string) => {
    setSelectedRunId(runId);
    try {
      const res = await fetch('/api/replay/select', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ run_id: runId })
      });
      if (res.ok) {
        const d = await res.json();
        setReplayState(d.state || 'idle');
      }
    } catch {}
  };

  const handlePlayReplay = async () => {
    try {
      const res = await fetch('/api/replay/play', { method: 'POST' });
      if (res.ok) setReplayState('playing');
    } catch {}
  };

  const handlePauseReplay = async () => {
    try {
      const res = await fetch('/api/replay/pause', { method: 'POST' });
      if (res.ok) setReplayState('paused');
    } catch {}
  };

  const handleRestartReplay = async () => {
    try {
      const res = await fetch('/api/replay/restart', { method: 'POST' });
      if (res.ok) setReplayState('idle');
    } catch {}
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

  const prob = Math.max(0, Math.min(1, telemetry?.prediction?.probability ?? telemetry?.prediction?.model_score ?? 0.05));
  const severityStage = getSeverityStage(prob);
  const severityColor = getSeverityColor(severityStage);
  const criticalActiveAlert = alerts.find(a => a.severity === 2 && a.status === 'active');
  const activeDegradation = Object.values(actuators).some(v => v > 0);

  // Phase 3: Format seconds into mm:ss
  const formatTime = (seconds: number) => {
    const s = Math.max(0, Math.floor(seconds));
    const mins = Math.floor(s / 60);
    const secs = s % 60;
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  // Phase 3: Dominant active fault for corrective guidance
  const dominantFault = useMemo(() => {
    let maxK = 'suction_restriction';
    let maxV = -1;
    for (const [k, v] of Object.entries(faultSeverities)) {
      if (v > maxV) {
        maxV = v;
        maxK = k;
      }
    }
    if (maxV <= 0 && mode === 'replay') {
      return 'suction_restriction';
    }
    return maxK;
  }, [faultSeverities, mode]);

  const activeFix = CORRECTIVE_ACTIONS[dominantFault] || CORRECTIVE_ACTIONS['suction_restriction'];
  const maxFaultSev = Math.max(0, ...Object.values(faultSeverities));

  // Phase 3: Early Warning & Cavitation Detected State Machine
  useEffect(() => {
    if (prob < 0.15) {
      // Re-arm when probability falls below 15%
      setWarnEpisodeArmed(true);
      setDetectedEpisodeArmed(true);
      setEarlyWarnActive(false);
      setDetectedActive(false);
      setEarlyWarnDismissed(false);
      setDetectedDismissed(false);
      return;
    }

    const simT = telemetry?.sim_t ?? 0;
    const history = telemetry?.prediction_history || [];

    // Calculate rise over last ~5s
    let prob5sAgo = prob;
    const targetT = simT - 5.0;
    for (let i = history.length - 1; i >= 0; i--) {
      if (history[i].sim_t <= targetT) {
        prob5sAgo = history[i].probability ?? history[i].model_score ?? prob;
        break;
      }
    }
    const rise5s = prob - prob5sAgo;

    // Condition 1: prob >= 25% and prob < 50%
    // Condition 2: rises 10 points within 5s and is at least 15%
    const shouldWarn = (prob >= WARN_PROB && prob < DETECT_PROB) || (rise5s >= 0.10 && prob >= 0.15);

    if (warnEpisodeArmed && shouldWarn) {
      const newWarnId = `warn_${Math.round(simT)}_${Date.now()}`;
      setEarlyWarnAlertId(newWarnId);
      setEarlyWarnActive(true);
      setEarlyWarnDismissed(false);
      setWarnTime(simT);
      setWarnEpisodeArmed(false);

      // Auto-log warning alert to data/feedback_log.csv as unreviewed
      fetch('/api/feedback/log', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          alert_id: newWarnId,
          timestamp: new Date().toISOString(),
          run_or_session_id: mode === 'replay' ? (selectedRunId || 'test_run') : 'manual_session',
          mode,
          alert_level: 'warning',
          probability: prob,
          suction_pressure: currentReadings.suction_pressure,
          discharge_pressure: currentReadings.discharge_pressure,
          flow_rate: currentReadings.flow_rate,
          vibration_rms: currentReadings.vibration_rms,
          temperature: currentReadings.temperature,
          motor_current: currentReadings.motor_current,
          active_faults: Object.entries(faultSeverities).filter(([_, v]) => v > 0).map(([k, v]) => `${k}:${v}%`).join(';') || 'none',
          verdict: 'unreviewed'
        })
      }).catch(() => {});
    }

    // When probability crosses 50%, show large alert: Cavitation predicted
    if (detectedEpisodeArmed && prob >= DETECT_PROB) {
      const newDetectId = `pred_${Math.round(simT)}_${Date.now()}`;
      setDetectedAlertId(newDetectId);
      setDetectedActive(true);
      setDetectedDismissed(false);
      setDetectTime(simT);
      setDetectedEpisodeArmed(false);

      // Auto-log predicted alert to data/feedback_log.csv as unreviewed
      fetch('/api/feedback/log', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          alert_id: newDetectId,
          timestamp: new Date().toISOString(),
          run_or_session_id: mode === 'replay' ? (selectedRunId || 'test_run') : 'manual_session',
          mode,
          alert_level: 'predicted',
          probability: prob,
          suction_pressure: currentReadings.suction_pressure,
          discharge_pressure: currentReadings.discharge_pressure,
          flow_rate: currentReadings.flow_rate,
          vibration_rms: currentReadings.vibration_rms,
          temperature: currentReadings.temperature,
          motor_current: currentReadings.motor_current,
          active_faults: Object.entries(faultSeverities).filter(([_, v]) => v > 0).map(([k, v]) => `${k}:${v}%`).join(';') || 'none',
          verdict: 'unreviewed'
        })
      }).catch(() => {});
    }
  }, [prob, telemetry, warnEpisodeArmed, detectedEpisodeArmed, mode, selectedRunId, currentReadings, faultSeverities]);

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
            Model
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
            Data and method
          </button>
        </nav>
      </header>

      {/* Phase 3 Small Alert: Early Warning Popup (Top Center with 3 Feedback Buttons) */}
      {earlyWarnActive && !earlyWarnDismissed && (
        <div style={{
          position: 'fixed',
          top: '16px',
          left: '50%',
          transform: 'translateX(-50%)',
          zIndex: 1000,
          backgroundColor: '#111827',
          border: '1px solid #f59e0b',
          borderRadius: '6px',
          padding: '10px 18px',
          display: 'flex',
          alignItems: 'center',
          gap: '16px',
          boxShadow: '0 4px 14px rgba(0,0,0,0.6)',
          pointerEvents: 'auto',
          transition: 'opacity 0.25s ease'
        }}>
          <div>
            <div style={{ fontSize: '13px', fontWeight: 700, color: '#f59e0b' }}>
              Early warning: cavitation risk rising
            </div>
            <div style={{ fontSize: '11.5px', color: '#cbd5e1', marginTop: '2px', fontFamily: 'monospace' }}>
              P = {Math.round(prob * 100)} % &bull; Time: {formatTime(warnTime ?? (telemetry?.sim_t || 0))}
            </div>
            <div style={{ fontSize: '11px', color: '#94a3b8', marginTop: '2px' }}>
              <strong style={{ color: '#cbd5e1' }}>Action: </strong>{activeFix}
            </div>
          </div>
          <div style={{ display: 'flex', gap: '6px', flexShrink: 0 }}>
            <button
              onClick={() => handleAlertVerdict(earlyWarnAlertId, 'acknowledged', 'warning')}
              style={{
                backgroundColor: '#1e293b',
                color: '#cbd5e1',
                border: '1px solid #334155',
                borderRadius: '4px',
                padding: '5px 12px',
                fontSize: '11.5px',
                fontWeight: 600,
                cursor: 'pointer'
              }}
              title="Acknowledge early warning"
            >
              Acknowledge
            </button>
          </div>
        </div>
      )}

      {/* Phase 3 Large Alert: Centered Modal Panel on Dimmed Backdrop (Usable & Non-blocking) */}
      {detectedActive && !detectedDismissed && (
        <div style={{
          position: 'fixed',
          top: 0,
          left: 0,
          width: '100vw',
          height: '100vh',
          backgroundColor: 'rgba(0, 0, 0, 0.40)', // Dimmed backdrop
          pointerEvents: 'none', // Backdrop does NOT block clicks outside the modal!
          zIndex: 9999,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          transition: 'opacity 0.25s ease'
        }}>
          <div style={{
            pointerEvents: 'auto', // Modal panel itself is fully interactive
            backgroundColor: '#111827',
            border: '1px solid #ef4444',
            borderRadius: '6px',
            padding: '24px 28px',
            width: '480px',
            maxWidth: '92vw',
            boxShadow: '0 8px 32px rgba(0, 0, 0, 0.75)',
            display: 'flex',
            flexDirection: 'column',
            gap: '14px'
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
              <h3 style={{ fontSize: '18px', fontWeight: 700, color: '#f8fafc', margin: 0 }}>
                Cavitation predicted
              </h3>
              <span style={{ fontSize: '13px', color: '#ef4444', fontFamily: 'monospace', fontWeight: 700 }}>
                P = {Math.round(prob * 100)} %
              </span>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', fontSize: '12px', fontFamily: 'monospace', color: '#94a3b8' }}>
              <div>Time: <strong style={{ color: '#f8fafc' }}>{formatTime(detectTime ?? (telemetry?.sim_t || 0))}</strong></div>
              <div>Mode: <strong style={{ color: '#38bdf8' }}>{mode.toUpperCase()}</strong></div>
              <div>Time to threshold: <strong style={{ color: '#ef4444' }}>0 s (Reached)</strong></div>
              <div>Severity margin: <strong style={{ color: '#ef4444' }}>0 % (Reached)</strong></div>
            </div>

            <div style={{ fontSize: '12px', color: '#cbd5e1', backgroundColor: '#0d1117', border: '1px solid #1e293b', borderRadius: '4px', padding: '10px 14px' }}>
              <div style={{ color: '#94a3b8', fontSize: '10.5px', marginBottom: '3px' }}>Suggested corrective action:</div>
              <strong style={{ color: '#38bdf8' }}>{activeFix}</strong>
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', marginTop: '6px' }}>
              <button
                onClick={() => handleAlertVerdict(detectedAlertId, 'acknowledged', 'detected')}
                style={{
                  backgroundColor: '#1e293b',
                  color: '#cbd5e1',
                  border: '1px solid #334155',
                  borderRadius: '4px',
                  padding: '6px 14px',
                  fontSize: '12px',
                  fontWeight: 600,
                  cursor: 'pointer'
                }}
              >
                Acknowledge
              </button>
              <button
                onClick={() => handleAlertVerdict(detectedAlertId, 'false_alarm', 'detected')}
                style={{
                  backgroundColor: 'transparent',
                  color: '#94a3b8',
                  border: '1px solid #475569',
                  borderRadius: '4px',
                  padding: '6px 14px',
                  fontSize: '12px',
                  fontWeight: 600,
                  cursor: 'pointer'
                }}
              >
                False alarm
              </button>
              <button
                onClick={() => handleAlertVerdict(detectedAlertId, 'correct', 'detected')}
                style={{
                  backgroundColor: '#ef4444',
                  color: '#ffffff',
                  border: 'none',
                  borderRadius: '4px',
                  padding: '6px 14px',
                  fontSize: '12px',
                  fontWeight: 700,
                  cursor: 'pointer'
                }}
              >
                Correct
              </button>
            </div>
          </div>
        </div>
      )}

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

      {/* 2. Sub-Header: Mode Toggle (Manual vs Replay CSV) + Run Selector + Live Stage Status */}
      <div style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        padding: '8px 24px',
        backgroundColor: '#0d1117',
        borderBottom: '1px solid #1e293b',
        flexShrink: 0,
        gap: '16px'
      }}>
        {/* Left: Mode Toggle & Context Controls */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '14px', flexWrap: 'wrap' }}>
          {/* Mode Switcher */}
          <div style={{
            display: 'inline-flex',
            backgroundColor: '#111827',
            padding: '2px',
            borderRadius: '4px',
            border: '1px solid #1e293b'
          }}>
            <button
              onClick={() => handleToggleMode('manual')}
              style={{
                background: mode === 'manual' ? '#1e293b' : 'transparent',
                color: mode === 'manual' ? '#38bdf8' : '#94a3b8',
                border: 'none',
                borderRadius: '3px',
                padding: '4px 10px',
                fontSize: '12px',
                fontWeight: 600,
                cursor: 'pointer'
              }}
            >
              Manual
            </button>
            <button
              onClick={() => handleToggleMode('replay')}
              style={{
                background: mode === 'replay' ? '#1e293b' : 'transparent',
                color: mode === 'replay' ? '#38bdf8' : '#94a3b8',
                border: 'none',
                borderRadius: '3px',
                padding: '4px 10px',
                fontSize: '12px',
                fontWeight: 600,
                cursor: 'pointer'
              }}
            >
              Replay CSV
            </button>
          </div>

          {/* Mode Specific Controls */}
          {mode === 'manual' ? (
            <div style={{
              color: '#94a3b8',
              fontFamily: 'monospace',
              fontSize: '13px',
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
                title={connected ? 'Live WebSocket connected' : 'Connecting or offline'}
              />
              <span>Mode: Manual Simulation</span>
              {activeDegradation && (
                <span style={{ fontSize: '11px', color: '#f59e0b', fontWeight: 600 }}>
                  (fault active)
                </span>
              )}
            </div>
          ) : (
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <span
                style={{
                  width: '6px',
                  height: '6px',
                  borderRadius: '50%',
                  backgroundColor: connected ? '#10b981' : '#ef4444',
                  display: 'inline-block'
                }}
                title={connected ? 'Live WebSocket connected' : 'Connecting or offline'}
              />

              {/* Real Run Selector Dropdown */}
              <select
                value={selectedRunId}
                onChange={(e) => handleSelectRun(e.target.value)}
                style={{
                  backgroundColor: '#111827',
                  color: '#f8fafc',
                  border: '1px solid #334155',
                  borderRadius: '4px',
                  padding: '3px 8px',
                  fontSize: '12px',
                  fontFamily: 'monospace',
                  cursor: 'pointer',
                  maxWidth: '310px'
                }}
                title="Select a run from data/test_runs.csv"
              >
                {replayRuns.map(r => (
                  <option key={r.run_id} value={r.run_id}>
                    {r.run_id} ({r.label})
                  </option>
                ))}
              </select>

              {/* Replay Buttons */}
              <button
                onClick={handlePlayReplay}
                disabled={replayState === 'playing'}
                style={{
                  backgroundColor: '#111827',
                  color: replayState === 'playing' ? '#64748b' : '#38bdf8',
                  border: '1px solid #334155',
                  borderRadius: '4px',
                  padding: '3px 10px',
                  fontSize: '12px',
                  fontWeight: 600,
                  cursor: replayState === 'playing' ? 'default' : 'pointer'
                }}
              >
                Play
              </button>

              <button
                onClick={handlePauseReplay}
                disabled={replayState !== 'playing'}
                style={{
                  backgroundColor: '#111827',
                  color: replayState !== 'playing' ? '#64748b' : '#cbd5e1',
                  border: '1px solid #334155',
                  borderRadius: '4px',
                  padding: '3px 10px',
                  fontSize: '12px',
                  fontWeight: 600,
                  cursor: replayState !== 'playing' ? 'default' : 'pointer'
                }}
              >
                Pause
              </button>

              <button
                onClick={handleRestartReplay}
                style={{
                  backgroundColor: '#111827',
                  color: '#cbd5e1',
                  border: '1px solid #334155',
                  borderRadius: '4px',
                  padding: '3px 10px',
                  fontSize: '12px',
                  fontWeight: 600,
                  cursor: 'pointer'
                }}
                title="Reset to 0s and clear chart"
              >
                Restart
              </button>

              {/* Progress Tracker */}
              <span style={{ fontSize: '12px', fontFamily: 'monospace', fontVariantNumeric: 'tabular-nums', color: '#94a3b8' }}>
                <span style={{ display: 'inline-block', minWidth: '22px', textAlign: 'right' }}>{replayProgress.current}</span>
                {' / '}
                <span style={{ display: 'inline-block', minWidth: '22px' }}>{replayProgress.total}</span> s
              </span>

              {/* Completion Indicator */}
              {replayState === 'complete' && (
                <span style={{ fontSize: '12px', fontWeight: 700, color: '#38bdf8', fontFamily: 'monospace' }}>
                  Run complete
                </span>
              )}
            </div>
          )}
        </div>

        {/* Right: Real ML Severity Stage & Probability */}
        <div style={{
          fontSize: '15px',
          fontWeight: 700,
          color: (replayState === 'complete' && mode === 'replay') ? '#38bdf8' : severityColor,
          fontFamily: '-apple-system, BlinkMacSystemFont, sans-serif',
          letterSpacing: '0.3px',
          flexShrink: 0,
          display: 'flex',
          alignItems: 'baseline',
          gap: '8px'
        }}>
          <span>{(replayState === 'complete' && mode === 'replay') ? 'Run complete' : severityStage}</span>
          <span style={{ fontFamily: 'monospace', fontVariantNumeric: 'tabular-nums', fontSize: '14px', color: '#94a3b8' }}>
            P = <span style={{ display: 'inline-block', minWidth: '28px', textAlign: 'right', color: (replayState === 'complete' && mode === 'replay') ? '#38bdf8' : severityColor }}>{Math.round(prob * 100)}</span> %
          </span>
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

            {/* Controls Section (Phase 2: Independent Multiple Faults) */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginTop: '2px', opacity: mode === 'replay' ? 0.45 : 1.0 }}>
              <div style={{ fontSize: '13px', color: '#94a3b8', fontWeight: 600 }}>
                Fault Controls
              </div>

              {/* Independent Fault Inputs */}
              {[
                { id: 'suction_restriction', label: 'Suction restriction' },
                { id: 'discharge_throttling', label: 'Discharge throttling' },
                { id: 'bearing_wear', label: 'Bearing wear' },
                { id: 'vibration_unbalance', label: 'Rotor unbalance' }
              ].map(f => {
                const sev = faultSeverities[f.id] || 0;
                return (
                  <div key={f.id} style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    backgroundColor: '#111827',
                    border: '1px solid #1e293b',
                    borderRadius: '4px',
                    padding: '3px 8px'
                  }}>
                    <span style={{ fontSize: '11.5px', color: '#cbd5e1' }}>{f.label}</span>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                      <button
                        onClick={() => handleAdjustFault(f.id, -10)}
                        disabled={mode === 'replay'}
                        style={{
                          background: 'none',
                          border: 'none',
                          color: mode === 'replay' ? '#475569' : '#cbd5e1',
                          fontSize: '15px',
                          fontWeight: 700,
                          cursor: mode === 'replay' ? 'not-allowed' : 'pointer',
                          padding: '0 6px'
                        }}
                      >
                        -
                      </button>
                      <span style={{
                        fontSize: '12px',
                        fontWeight: 700,
                        color: sev > 0 ? '#38bdf8' : '#64748b',
                        fontFamily: 'monospace',
                        width: '38px',
                        textAlign: 'center',
                        fontVariantNumeric: 'tabular-nums'
                      }}>
                        {sev} %
                      </span>
                      <button
                        onClick={() => handleAdjustFault(f.id, +10)}
                        disabled={mode === 'replay'}
                        style={{
                          background: 'none',
                          border: 'none',
                          color: mode === 'replay' ? '#475569' : '#cbd5e1',
                          fontSize: '15px',
                          fontWeight: 700,
                          cursor: mode === 'replay' ? 'not-allowed' : 'pointer',
                          padding: '0 6px'
                        }}
                      >
                        +
                      </button>
                    </div>
                  </div>
                );
              })}

              {/* Small List of Active Faults with their Severities */}
              <div style={{
                backgroundColor: '#111827',
                border: '1px solid #1e293b',
                borderRadius: '4px',
                padding: '6px 10px',
                fontSize: '11px'
              }}>
                <div style={{ color: '#94a3b8', fontWeight: 600, marginBottom: '2px' }}>Active Faults:</div>
                {Object.entries(faultSeverities).filter(([_, v]) => v > 0).length === 0 ? (
                  <div style={{ color: '#64748b' }}>Nominal healthy baseline (0%)</div>
                ) : (
                  Object.entries(faultSeverities)
                    .filter(([_, v]) => v > 0)
                    .map(([k, v]) => (
                      <div key={k} style={{ display: 'flex', justifyContent: 'space-between', fontFamily: 'monospace', color: '#cbd5e1' }}>
                        <span>• {k.replace('_', ' ')}</span>
                        <strong style={{ color: '#38bdf8' }}>{v} %</strong>
                      </div>
                    ))
                )}
              </div>

              {/* Action Buttons: Reset */}
              <div style={{ display: 'flex', gap: '8px', marginTop: '2px' }}>
                <button
                  onClick={handleResetFault}
                  disabled={mode === 'replay'}
                  style={{
                    flex: 1,
                    backgroundColor: '#111827',
                    color: mode === 'replay' ? '#64748b' : '#cbd5e1',
                    border: '1px solid #334155',
                    borderRadius: '6px',
                    padding: '6px 12px',
                    fontSize: '12px',
                    fontWeight: 600,
                    cursor: mode === 'replay' ? 'not-allowed' : 'pointer',
                    transition: 'all 0.15s ease'
                  }}
                  title="Set all faults to 0%, clear chart and markers"
                >
                  Reset (All to 0 %)
                </button>
              </div>

              {mode === 'replay' && (
                <div style={{ fontSize: '11px', color: '#64748b', fontStyle: 'italic', textAlign: 'center' }}>
                  Manual fault controls disabled in Replay mode
                </div>
              )}
            </div>
          </div>

          {/* Right Column: Main Cavitation Probability Chart */}
          <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
            <CavitationProbabilityChart
              currentProbability={prob}
              history={telemetry?.prediction_history || []}
              faultSeverityPercent={maxFaultSev}
              faultActive={faultActive}
              activeFaultType={dominantFault}
              correctiveAction={activeFix}
            />
          </div>
        </main>
      )}

      {/* Model & Diagnostics Tab (Phase 6) */}
      {activeTab === 'analytics' && (
        <main style={{ flex: 1, padding: '16px 24px', overflowY: 'auto' }}>
          <AnalyticsPanel metrics={metrics} />
        </main>
      )}

      {/* Third Page: "Data and method" (Phase 5) */}
      {activeTab === 'history' && (
        <main style={{ flex: 1, padding: '16px 24px', overflowY: 'auto' }}>
          <DataMethodPanel />
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
          <div style={{ fontSize: '16px', fontWeight: 700, color: '#f8fafc', fontFamily: 'monospace', fontVariantNumeric: 'tabular-nums' }}>
            <span style={{ display: 'inline-block', minWidth: '45px' }}>
              {currentReadings.suction_pressure !== null ? currentReadings.suction_pressure.toFixed(2) : '0.42'}
            </span>{' '}
            <span style={{ fontSize: '12px', fontWeight: 400, color: '#94a3b8' }}>bar</span>
          </div>
        </div>

        {/* 2. Discharge press. */}
        <div style={{ padding: '0 24px', borderRight: '1px solid #1e293b' }}>
          <div style={{ fontSize: '12px', color: '#94a3b8', marginBottom: '3px' }}>
            Discharge press.
          </div>
          <div style={{ fontSize: '16px', fontWeight: 700, color: '#f8fafc', fontFamily: 'monospace', fontVariantNumeric: 'tabular-nums' }}>
            <span style={{ display: 'inline-block', minWidth: '45px' }}>
              {currentReadings.discharge_pressure !== null ? currentReadings.discharge_pressure.toFixed(2) : '4.10'}
            </span>{' '}
            <span style={{ fontSize: '12px', fontWeight: 400, color: '#94a3b8' }}>bar</span>
          </div>
        </div>

        {/* 3. Flow */}
        <div style={{ padding: '0 24px', borderRight: '1px solid #1e293b' }}>
          <div style={{ fontSize: '12px', color: '#94a3b8', marginBottom: '3px' }}>
            Flow
          </div>
          <div style={{ fontSize: '16px', fontWeight: 700, color: '#f8fafc', fontFamily: 'monospace', fontVariantNumeric: 'tabular-nums' }}>
            <span style={{ display: 'inline-block', minWidth: '45px' }}>
              {currentReadings.flow_rate !== null ? currentReadings.flow_rate.toFixed(1) : '38.2'}
            </span>{' '}
            <span style={{ fontSize: '12px', fontWeight: 400, color: '#94a3b8' }}>m3/h</span>
          </div>
        </div>

        {/* 4. Vibration RMS */}
        <div style={{ padding: '0 24px', borderRight: '1px solid #1e293b' }}>
          <div style={{ fontSize: '12px', color: '#94a3b8', marginBottom: '3px' }}>
            Vibration RMS
          </div>
          <div style={{ fontSize: '16px', fontWeight: 700, color: '#f8fafc', fontFamily: 'monospace', fontVariantNumeric: 'tabular-nums' }}>
            <span style={{ display: 'inline-block', minWidth: '40px' }}>
              {currentReadings.vibration_rms !== null ? currentReadings.vibration_rms.toFixed(1) : '6.8'}
            </span>{' '}
            <span style={{ fontSize: '12px', fontWeight: 400, color: '#94a3b8' }}>mm/s</span>
          </div>
        </div>

        {/* 5. Motor current */}
        <div style={{ padding: '0 24px', borderRight: '1px solid #1e293b' }}>
          <div style={{ fontSize: '12px', color: '#94a3b8', marginBottom: '3px' }}>
            Motor current
          </div>
          <div style={{ fontSize: '16px', fontWeight: 700, color: '#f8fafc', fontFamily: 'monospace', fontVariantNumeric: 'tabular-nums' }}>
            <span style={{ display: 'inline-block', minWidth: '45px' }}>
              {currentReadings.motor_current !== undefined && currentReadings.motor_current !== null
                ? currentReadings.motor_current.toFixed(1)
                : '11.9'}
            </span>{' '}
            <span style={{ fontSize: '12px', fontWeight: 400, color: '#94a3b8' }}>A</span>
          </div>
        </div>

        {/* 6. Temperature */}
        <div style={{ padding: '0 24px' }}>
          <div style={{ fontSize: '12px', color: '#94a3b8', marginBottom: '3px' }}>
            Temperature
          </div>
          <div style={{ fontSize: '16px', fontWeight: 700, color: '#f8fafc', fontFamily: 'monospace', fontVariantNumeric: 'tabular-nums' }}>
            <span style={{ display: 'inline-block', minWidth: '32px' }}>
              {currentReadings.temperature !== null ? currentReadings.temperature.toFixed(0) : '58'}
            </span>{' '}
            <span style={{ fontSize: '12px', fontWeight: 400, color: '#94a3b8' }}>degC</span>
          </div>
        </div>
      </footer>
    </div>
  );
};
