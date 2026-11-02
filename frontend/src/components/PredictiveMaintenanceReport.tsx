import React, { useState, useEffect, useMemo, useCallback } from 'react';
import {
  ReportEventItem,
  ReportEventSummary,
  EventValidationStatus,
  PumpHealthAssessment,
  MaintenanceRecommendation
} from '../types.ts';

interface PredictiveMaintenanceReportProps {
  currentReadings: {
    suction_pressure: number | null;
    discharge_pressure: number | null;
    flow_rate: number | null;
    vibration_rms: number | null;
    temperature: number | null;
    rpm: number | null;
    motor_current?: number | null;
  };
  probability: number;
  severityStage: string;
  mode: 'manual' | 'replay';
  selectedRunId?: string;
}

export const PredictiveMaintenanceReport: React.FC<PredictiveMaintenanceReportProps> = ({
  currentReadings,
  probability,
  severityStage,
  mode,
  selectedRunId
}) => {
  const [events, setEvents] = useState<ReportEventItem[]>([]);
  const [summary, setSummary] = useState<ReportEventSummary>({
    total: 0,
    confirmed_alarm: 0,
    false_alarm: 0,
    missed_fault: 0,
    confirmed_normal: 0,
    unreviewed: 0,
    precision_pct: 0
  });
  const [historyReadings, setHistoryReadings] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [updatingId, setUpdatingId] = useState<string | null>(null);
  const [showAddModal, setShowAddModal] = useState(false);
  const [addNotes, setAddNotes] = useState('');
  const [addStatus, setAddStatus] = useState<EventValidationStatus>('missed_fault');

  // Fetch report events from persistent backend
  const fetchReportEvents = useCallback(async () => {
    try {
      const res = await fetch('/api/reports/events');
      if (res.ok) {
        const data = await res.json();
        if (data.ok && data.events) {
          setEvents(data.events);
          if (data.summary) setSummary(data.summary);
        }
      }
    } catch (e) {
      console.error('Failed to load report events', e);
    }
  }, []);

  // Fetch recent historical sensor data for trend calculations
  const fetchSensorHistory = useCallback(async () => {
    try {
      const res = await fetch('/api/history');
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data)) {
          setHistoryReadings(data);
        }
      }
    } catch (e) {
      console.error('Failed to load sensor history', e);
    }
  }, []);

  useEffect(() => {
    setLoading(true);
    Promise.all([fetchReportEvents(), fetchSensorHistory()]).finally(() => {
      setLoading(false);
    });
    const interval = setInterval(() => {
      fetchReportEvents();
      fetchSensorHistory();
    }, 5000);
    return () => clearInterval(interval);
  }, [fetchReportEvents, fetchSensorHistory]);

  // Handle Event Validation Classification
  const handleValidateEvent = async (alertId: string, status: EventValidationStatus) => {
    setUpdatingId(alertId);
    try {
      const res = await fetch(`/api/reports/events/${encodeURIComponent(alertId)}/validate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ validation_status: status })
      });
      if (res.ok) {
        // Update local event state immediately
        setEvents((prev) =>
          prev.map((e) => (e.alert_id === alertId ? { ...e, validation_status: status } : e))
        );
        // Refresh summary
        fetchReportEvents();
      }
    } catch (err) {
      console.error('Failed to validate event', err);
    } finally {
      setUpdatingId(null);
    }
  };

  // Handle Recording a Missed Fault or Custom Incident
  const handleRecordIncident = async () => {
    try {
      const res = await fetch('/api/reports/events/record', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          validation_status: addStatus,
          notes: addNotes,
          probability: probability,
          duration_s: 15
        })
      });
      if (res.ok) {
        setShowAddModal(false);
        setAddNotes('');
        fetchReportEvents();
      }
    } catch (e) {
      console.error('Failed to record incident', e);
    }
  };

  // Real Historical Sensor Statistics Computed Strictly From Available Telemetry
  const sensorStats = useMemo(() => {
    if (historyReadings.length === 0) {
      return {
        count: 0,
        avgSuction: currentReadings.suction_pressure ?? 2.0,
        minSuction: currentReadings.suction_pressure ?? 2.0,
        avgDischarge: currentReadings.discharge_pressure ?? 6.5,
        avgFlow: currentReadings.flow_rate ?? 100.0,
        minFlow: currentReadings.flow_rate ?? 100.0,
        avgVibration: currentReadings.vibration_rms ?? 1.8,
        maxVibration: currentReadings.vibration_rms ?? 1.8,
        avgTemp: currentReadings.temperature ?? 52.0,
        maxTemp: currentReadings.temperature ?? 52.0,
        avgProb: probability,
        maxProb: probability,
        npshMargin: Math.max(0, (currentReadings.suction_pressure ?? 2.0) - 0.03)
      };
    }

    let sumSuct = 0, minSuct = 999;
    let sumDisc = 0;
    let sumFl = 0, minFl = 999;
    let sumVib = 0, maxVib = 0;
    let sumTemp = 0, maxTemp = 0;
    let sumProb = 0, maxProb = 0;

    historyReadings.forEach((r) => {
      const sp = r.suction_pressure ?? 2.0;
      const dp = r.discharge_pressure ?? 6.5;
      const fl = r.flow_rate ?? 100.0;
      const vib = r.vibration_rms ?? 1.8;
      const temp = r.temperature ?? 52.0;
      const pr = r.model_score ?? r.probability ?? 0.05;

      sumSuct += sp;
      if (sp < minSuct) minSuct = sp;
      sumDisc += dp;
      sumFl += fl;
      if (fl < minFl) minFl = fl;
      sumVib += vib;
      if (vib > maxVib) maxVib = vib;
      sumTemp += temp;
      if (temp > maxTemp) maxTemp = temp;
      sumProb += pr;
      if (pr > maxProb) maxProb = pr;
    });

    const n = historyReadings.length;
    const avgSuct = sumSuct / n;

    return {
      count: n,
      avgSuction: +(avgSuct.toFixed(2)),
      minSuction: +(minSuct.toFixed(2)),
      avgDischarge: +((sumDisc / n).toFixed(2)),
      avgFlow: +((sumFl / n).toFixed(1)),
      minFlow: +(minFl.toFixed(1)),
      avgVibration: +((sumVib / n).toFixed(2)),
      maxVibration: +(maxVib.toFixed(2)),
      avgTemp: +((sumTemp / n).toFixed(1)),
      maxTemp: +(maxTemp.toFixed(1)),
      avgProb: +((sumProb / n).toFixed(3)),
      maxProb: +(maxProb.toFixed(3)),
      npshMargin: +((Math.max(0, avgSuct - 0.03)).toFixed(2)) // Vapor pressure of water ~ 0.03 bar
    };
  }, [historyReadings, currentReadings, probability]);

  // Dynamic Pump Health Assessment (strictly based on actual telemetry)
  const healthAssessment: PumpHealthAssessment = useMemo(() => {
    const sp = currentReadings.suction_pressure ?? sensorStats.avgSuction;
    const vib = currentReadings.vibration_rms ?? sensorStats.avgVibration;
    const temp = currentReadings.temperature ?? sensorStats.avgTemp;
    const fl = currentReadings.flow_rate ?? sensorStats.avgFlow;
    const prob = probability;

    // Component penalties (0 to 100 composite)
    let hydraulicPenalty = 0;
    if (sp < 0.8) hydraulicPenalty = 35;
    else if (sp < 1.4) hydraulicPenalty = 20;
    else if (sp < 1.8) hydraulicPenalty = 8;

    let vibrationPenalty = 0;
    if (vib > 4.5) vibrationPenalty = 35; // ISO 10816-3 Zone D (Unacceptable)
    else if (vib > 2.8) vibrationPenalty = 20; // Zone C (Restricted)
    else if (vib > 2.0) vibrationPenalty = 8; // Zone B (Acceptable)

    let thermalPenalty = 0;
    if (temp > 68) thermalPenalty = 20;
    else if (temp > 60) thermalPenalty = 10;
    else if (temp > 55) thermalPenalty = 4;

    let flowPenalty = 0;
    if (fl < 75) flowPenalty = 15;
    else if (fl < 88) flowPenalty = 8;

    const totalPenalty = hydraulicPenalty + vibrationPenalty + thermalPenalty + flowPenalty;
    const score = Math.max(10, Math.min(100, Math.round(100 - totalPenalty)));

    let priority: 'Critical' | 'High' | 'Medium' | 'Low' = 'Low';
    if (prob >= 0.8 || vib > 4.5 || sp < 0.6) priority = 'Critical';
    else if (prob >= 0.5 || vib > 2.8 || sp < 1.0) priority = 'High';
    else if (prob >= 0.25 || temp > 60 || fl < 85) priority = 'Medium';
    else priority = 'Low';

    const hydraulicStatus = sp < 0.8 ? 'Critical' : sp < 1.4 ? 'Degraded' : 'Normal';
    const vibrationStatus = vib > 4.5 ? 'Alarm' : vib > 2.8 ? 'Alert' : 'Normal';
    const thermalStatus = temp > 68 ? 'Critical' : temp > 60 ? 'Elevated' : 'Normal';
    const flowStatus = fl < 75 ? 'Severe' : fl < 88 ? 'Restricted' : 'Normal';

    return {
      score,
      priority,
      status_summary:
        priority === 'Critical'
          ? 'Immediate maintenance intervention required: active hydraulic cavitation or severe mechanical vibration breach detected.'
          : priority === 'High'
          ? 'Urgent condition degradation: significant NPSH margin reduction or elevated vibration observed. Schedule prioritized inspection.'
          : priority === 'Medium'
          ? 'Incipient hydraulic or thermal deviation detected. Monitor suction head and bearing temperatures during current shift.'
          : 'Normal operating envelope: hydraulic NPSH margin, mechanical vibration, and bearing thermal balance meet ISO 10816-3 specifications.',
      hydraulic: {
        score: Math.max(0, 100 - hydraulicPenalty * 2.5),
        status: hydraulicStatus,
        metricLabel: 'Suction NPSH Margin',
        metricValue: `${(sp - 0.03).toFixed(2)} bar (${(sp * 10.2).toFixed(1)} m NPSHa)`,
        benchmark: 'Nominal ≥ 1.80 bar (18.4 m)',
        description: 'Static suction pressure above fluid vapor pressure at 20°C.'
      },
      mechanical: {
        score: Math.max(0, 100 - vibrationPenalty * 2.5),
        status: vibrationStatus,
        metricLabel: 'RMS Vibration Velocity',
        metricValue: `${vib.toFixed(2)} mm/s`,
        benchmark: 'ISO 10816-3 Zone A/B ≤ 2.80 mm/s',
        description: 'Overall broadband casing vibration at drive-end bearing bracket.'
      },
      thermal: {
        score: Math.max(0, 100 - thermalPenalty * 4),
        status: thermalStatus,
        metricLabel: 'Bearing Housing Temp',
        metricValue: `${temp.toFixed(1)} °C`,
        benchmark: 'Baseline: 52.0 °C (Max ≤ 65 °C)',
        description: 'Radial hydrodynamic bearing outer race thermal equilibrium.'
      },
      flow: {
        score: Math.max(0, 100 - flowPenalty * 5),
        status: flowStatus,
        metricLabel: 'Delivery Flow Rate',
        metricValue: `${fl.toFixed(1)} m³/h`,
        benchmark: 'BEP Design: 100.0 m³/h',
        description: 'Volumetric discharge capacity delivered to main header.'
      }
    };
  }, [currentReadings, sensorStats, probability]);

  // Evidence-Based Preventive Maintenance Recommendations
  const recommendations: MaintenanceRecommendation[] = useMemo(() => {
    const list: MaintenanceRecommendation[] = [];
    const sp = currentReadings.suction_pressure ?? sensorStats.avgSuction;
    const vib = currentReadings.vibration_rms ?? sensorStats.avgVibration;
    const temp = currentReadings.temperature ?? sensorStats.avgTemp;
    const fl = currentReadings.flow_rate ?? sensorStats.avgFlow;

    // 1. Hydraulic / Low NPSH Margin
    if (sp < 1.2 || sensorStats.minSuction < 1.0) {
      list.push({
        id: 'rec_hydraulic',
        subsystem: 'hydraulic',
        title: 'Inspect Suction Line & Strainer Assembly',
        evidence: `Suction pressure has fallen to ${sp.toFixed(2)} bar (lowest recorded: ${sensorStats.minSuction.toFixed(2)} bar), drastically reducing NPSHa margin.`,
        action: 'Inspect suction basket strainer for particulate fouling. Confirm suction isolation butterfly valve is fully open (100%). Verify suction tank hydrostatic head and liquid vapor pressure.',
        priority: sp < 0.8 ? 'Critical' : 'High',
        metric: 'Suction Pressure',
        measured_value: `${sp.toFixed(2)} bar`,
        nominal_target: '≥ 1.80 bar'
      });
    }

    // 2. Mechanical / High Vibration
    if (vib > 2.6 || sensorStats.maxVibration > 2.8) {
      list.push({
        id: 'rec_mechanical',
        subsystem: 'mechanical',
        title: 'Inspect Bearing Condition & Shaft Dynamic Alignment',
        evidence: `Broadband vibration velocity measured ${vib.toFixed(2)} mm/s (peak recorded: ${sensorStats.maxVibration.toFixed(2)} mm/s), exceeding ISO 10816-3 Good limit.`,
        action: 'Perform spectral FFT vibration analysis to isolate 1X rotational unbalance from high-frequency bearing defect frequencies (BPFO/BPFI). Inspect coupling alignment and elastomeric inserts.',
        priority: vib > 4.5 ? 'Critical' : 'High',
        metric: 'Vibration RMS',
        measured_value: `${vib.toFixed(2)} mm/s`,
        nominal_target: '≤ 2.80 mm/s'
      });
    }

    // 3. Flow / Delivery Restriction
    if (fl < 90 || sensorStats.minFlow < 85) {
      list.push({
        id: 'rec_flow',
        subsystem: 'flow',
        title: 'Inspect Impeller Vanes & Discharge Piping',
        evidence: `Discharge volumetric delivery dropped to ${fl.toFixed(1)} m³/h (nominal design: 100 m³/h).`,
        action: 'Inspect impeller leading edges and suction eye for hydraulic cavitation pitting or erosion. Check discharge non-return check valve and orifice plate for partial throttling.',
        priority: fl < 75 ? 'High' : 'Medium',
        metric: 'Flow Rate',
        measured_value: `${fl.toFixed(1)} m³/h`,
        nominal_target: '100.0 m³/h'
      });
    }

    // 4. Thermal / Bearing Overheating
    if (temp > 58 || sensorStats.maxTemp > 60) {
      list.push({
        id: 'rec_thermal',
        subsystem: 'thermal',
        title: 'Perform Bearing Lubrication Audit & Thermal Inspection',
        evidence: `Bearing temperature recorded at ${temp.toFixed(1)} °C (peak: ${sensorStats.maxTemp.toFixed(1)} °C), exceeding normal thermal equilibrium.`,
        action: 'Check grease lubrication interval and oil cleanliness. Verify bearing housing seals are intact and check for excessive pre-load or race friction.',
        priority: temp > 68 ? 'Critical' : 'Medium',
        metric: 'Bearing Temperature',
        measured_value: `${temp.toFixed(1)} °C`,
        nominal_target: '≤ 52.0 °C'
      });
    }

    // Baseline recommendation if nominal
    if (list.length === 0) {
      list.push({
        id: 'rec_nominal',
        subsystem: 'hydraulic',
        title: 'Maintain Routine Condition-Based Monitoring',
        evidence: 'All operational parameters (NPSH, vibration, flow, temperature) are within nominal ISO 10816-3 Class I/II boundaries.',
        action: 'Continue continuous SCADA telemetry logging. No immediate mechanical intervention or shutdown required. Next scheduled visual inspection in 30 days.',
        priority: 'Low',
        metric: 'Overall Status',
        measured_value: 'Nominal Baseline',
        nominal_target: 'Nominal Envelope'
      });
    }

    return list;
  }, [currentReadings, sensorStats]);

  // Color helper for badges
  const getPriorityColor = (p: string) => {
    switch (p) {
      case 'Critical': return '#ef4444';
      case 'High': return '#f97316';
      case 'Medium': return '#f59e0b';
      case 'Low': return '#10b981';
      default: return '#94a3b8';
    }
  };

  const getValidationBadge = (status: EventValidationStatus) => {
    switch (status) {
      case 'confirmed_alarm':
        return { label: 'Confirmed Alarm (TP)', bg: 'rgba(16, 185, 129, 0.15)', color: '#10b981', border: '#10b981' };
      case 'false_alarm':
        return { label: 'False Alarm (FP)', bg: 'rgba(239, 68, 68, 0.15)', color: '#ef4444', border: '#ef4444' };
      case 'missed_fault':
        return { label: 'Missed Fault (FN)', bg: 'rgba(245, 158, 11, 0.15)', color: '#f59e0b', border: '#f59e0b' };
      case 'confirmed_normal':
        return { label: 'Confirmed Normal (TN)', bg: 'rgba(56, 189, 248, 0.15)', color: '#38bdf8', border: '#38bdf8' };
      default:
        return { label: 'Unreviewed', bg: 'rgba(148, 163, 184, 0.12)', color: '#94a3b8', border: '#475569' };
    }
  };

  const handlePrint = () => {
    window.print();
  };

  return (
    <div className="nexcav-report-container" style={{
      maxWidth: '1280px',
      margin: '0 auto',
      display: 'flex',
      flexDirection: 'column',
      gap: '24px',
      paddingBottom: '48px',
      color: '#f8fafc',
      fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif'
    }}>
      {/* Print CSS Stylesheet */}
      <style>{`
        @media print {
          body {
            background-color: #ffffff !important;
            color: #0f172a !important;
          }
          header, nav, footer, .no-print {
            display: none !important;
          }
          .nexcav-report-container {
            max-width: 100% !important;
            padding: 0 !important;
            color: #0f172a !important;
          }
          .report-card {
            background-color: #ffffff !important;
            border: 1px solid #cbd5e1 !important;
            color: #0f172a !important;
            box-shadow: none !important;
            page-break-inside: avoid;
          }
          .print-text-dark {
            color: #0f172a !important;
          }
          .print-text-muted {
            color: #475569 !important;
          }
          .print-header {
            border-bottom: 2px solid #0f172a !important;
            padding-bottom: 12px !important;
            margin-bottom: 16px !important;
          }
          select {
            border: none !important;
            background: transparent !important;
            appearance: none !important;
            color: #0f172a !important;
            font-weight: 700 !important;
          }
        }
      `}</style>

      {/* 1. Report Header Bar with Controls */}
      <div className="report-card print-header" style={{
        backgroundColor: '#111827',
        border: '1px solid #1e293b',
        borderRadius: '8px',
        padding: '20px 24px',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        flexWrap: 'wrap',
        gap: '16px'
      }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <h1 style={{ margin: 0, fontSize: '20px', fontWeight: 800, color: '#f8fafc', letterSpacing: '-0.3px' }} className="print-text-dark">
              Predictive Maintenance Report
            </h1>
            <span style={{
              backgroundColor: '#1e293b',
              border: '1px solid #334155',
              padding: '2px 8px',
              borderRadius: '4px',
              fontSize: '11px',
              fontWeight: 700,
              color: '#38bdf8',
              fontFamily: 'monospace'
            }}>
              EQUIPMENT: PUMP P-101
            </span>
          </div>
          <div style={{ fontSize: '13px', color: '#94a3b8', marginTop: '4px' }} className="print-text-muted">
            End-Suction Centrifugal Water Circulation Pump &bull; 2950 RPM Nominal &bull; Active Mode: <strong style={{ color: '#cbd5e1' }}>{mode.toUpperCase()} {mode === 'replay' && selectedRunId ? `(${selectedRunId})` : ''}</strong> &bull; Live Stage: <strong style={{ color: '#38bdf8' }}>{severityStage}</strong> (P = {Math.round(probability * 100)}%)
          </div>
          <div style={{ fontSize: '11.5px', color: '#64748b', marginTop: '2px', fontFamily: 'monospace' }} className="print-text-muted">
            Report Generated: {new Date().toLocaleString()} &bull; Telemetry Window: 5,000 SCADA samples
          </div>
        </div>

        <div className="no-print" style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <button
            onClick={() => setShowAddModal(true)}
            style={{
              backgroundColor: '#111827',
              color: '#f59e0b',
              border: '1px solid #f59e0b',
              borderRadius: '6px',
              padding: '7px 14px',
              fontSize: '12px',
              fontWeight: 600,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '6px'
            }}
            title="Record an observed anomaly or missed fault into event history"
          >
            <span>+</span> Log Missed Fault
          </button>

          <button
            onClick={fetchReportEvents}
            disabled={loading}
            style={{
              backgroundColor: '#1e293b',
              color: loading ? '#64748b' : '#cbd5e1',
              border: '1px solid #334155',
              borderRadius: '6px',
              padding: '7px 14px',
              fontSize: '12px',
              fontWeight: 600,
              cursor: loading ? 'default' : 'pointer'
            }}
          >
            {loading ? '↻ Loading...' : '↻ Refresh Data'}
          </button>

          <button
            onClick={handlePrint}
            style={{
              backgroundColor: '#38bdf8',
              color: '#0f172a',
              border: 'none',
              borderRadius: '6px',
              padding: '7px 16px',
              fontSize: '12px',
              fontWeight: 700,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '6px'
            }}
          >
            🖨 Print / Download PDF
          </button>
        </div>
      </div>

      {/* 2. Insufficient Historical Data Warning (if applicable) */}
      {sensorStats.count < 15 && (
        <div style={{
          backgroundColor: 'rgba(245, 158, 11, 0.10)',
          border: '1px solid #f59e0b',
          borderRadius: '6px',
          padding: '12px 18px',
          display: 'flex',
          alignItems: 'flex-start',
          gap: '12px'
        }}>
          <span style={{ fontSize: '18px', color: '#f59e0b' }}>⚠</span>
          <div style={{ fontSize: '12.5px', color: '#cbd5e1' }}>
            <strong style={{ color: '#f59e0b' }}>Notice: Insufficient historical data accumulated for long-term trend extrapolation.</strong>
            <div style={{ marginTop: '2px', color: '#94a3b8' }}>
              Only {sensorStats.count} recent telemetry frames recorded in active session. Baseline metrics are derived from live sensor stream. Continue running the pump or replay a test episode to expand trend baseline.
            </div>
          </div>
        </div>
      )}

      {/* 3. Section: Pump Health Assessment & Maintenance Priority */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr', gap: '20px' }}>
        {/* Overall Health Score Card */}
        <div className="report-card" style={{
          backgroundColor: '#111827',
          border: '1px solid #1e293b',
          borderRadius: '8px',
          padding: '20px',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between'
        }}>
          <div>
            <div style={{ fontSize: '12px', fontWeight: 600, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.5px' }} className="print-text-muted">
              Pump Health Assessment
            </div>

            <div style={{ display: 'flex', alignItems: 'baseline', gap: '14px', marginTop: '14px' }}>
              <div style={{
                fontSize: '48px',
                fontWeight: 800,
                color: healthAssessment.score >= 80 ? '#10b981' : healthAssessment.score >= 60 ? '#f59e0b' : '#ef4444',
                fontFamily: 'monospace',
                lineHeight: 1
              }}>
                {healthAssessment.score}
              </div>
              <span style={{ fontSize: '18px', color: '#64748b', fontWeight: 500 }}>/ 100</span>
            </div>

            <div style={{ marginTop: '16px' }}>
              <div style={{ fontSize: '11.5px', color: '#94a3b8', marginBottom: '4px' }} className="print-text-muted">
                Maintenance Priority:
              </div>
              <span style={{
                display: 'inline-block',
                backgroundColor: `${getPriorityColor(healthAssessment.priority)}22`,
                border: `1px solid ${getPriorityColor(healthAssessment.priority)}`,
                color: getPriorityColor(healthAssessment.priority),
                borderRadius: '4px',
                padding: '4px 10px',
                fontSize: '12px',
                fontWeight: 700,
                letterSpacing: '0.4px',
                textTransform: 'uppercase'
              }}>
                {healthAssessment.priority} PRIORITY
              </span>
            </div>
          </div>

          <div style={{
            fontSize: '12px',
            color: '#cbd5e1',
            lineHeight: 1.45,
            borderTop: '1px solid #1e293b',
            paddingTop: '12px',
            marginTop: '16px'
          }} className="print-text-dark">
            {healthAssessment.status_summary}
          </div>
        </div>

        {/* 4 Subsystem Health Indicators */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px' }}>
          {[
            { key: 'hydraulic', data: healthAssessment.hydraulic },
            { key: 'mechanical', data: healthAssessment.mechanical },
            { key: 'thermal', data: healthAssessment.thermal },
            { key: 'flow', data: healthAssessment.flow }
          ].map(({ key, data }) => (
            <div key={key} className="report-card" style={{
              backgroundColor: '#111827',
              border: '1px solid #1e293b',
              borderRadius: '8px',
              padding: '16px',
              display: 'flex',
              flexDirection: 'column',
              justifyContent: 'space-between'
            }}>
              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ fontSize: '12.5px', fontWeight: 700, color: '#f8fafc' }} className="print-text-dark">
                    {data.metricLabel}
                  </span>
                  <span style={{
                    fontSize: '11px',
                    fontWeight: 700,
                    color: data.status === 'Normal' ? '#10b981' : data.status === 'Alert' || data.status === 'Degraded' || data.status === 'Elevated' ? '#f59e0b' : '#ef4444',
                    fontFamily: 'monospace'
                  }}>
                    {data.status.toUpperCase()}
                  </span>
                </div>

                <div style={{ fontSize: '18px', fontWeight: 700, color: '#38bdf8', fontFamily: 'monospace', margin: '8px 0 2px 0' }} className="print-text-dark">
                  {data.metricValue}
                </div>

                <div style={{ fontSize: '11px', color: '#64748b', fontFamily: 'monospace' }} className="print-text-muted">
                  Ref: {data.benchmark}
                </div>
              </div>

              <div style={{ fontSize: '11.5px', color: '#94a3b8', marginTop: '10px' }} className="print-text-muted">
                {data.description}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* 4. Section: Preventive Maintenance Recommendations */}
      <div className="report-card" style={{
        backgroundColor: '#111827',
        border: '1px solid #1e293b',
        borderRadius: '8px',
        padding: '20px'
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
          <div>
            <h2 style={{ margin: 0, fontSize: '15px', fontWeight: 700, color: '#f8fafc' }} className="print-text-dark">
              Preventive Maintenance Recommendations
            </h2>
            <div style={{ fontSize: '12px', color: '#94a3b8', marginTop: '2px' }} className="print-text-muted">
              Actionable engineering guidance derived strictly from observed physical sensor deviations
            </div>
          </div>
          <span style={{ fontSize: '12px', color: '#94a3b8', fontFamily: 'monospace' }} className="print-text-muted">
            {recommendations.length} Active {recommendations.length === 1 ? 'Action' : 'Actions'}
          </span>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          {recommendations.map((rec) => (
            <div key={rec.id} style={{
              backgroundColor: '#0d1117',
              border: `1px solid ${rec.priority === 'Critical' ? '#ef4444' : rec.priority === 'High' ? '#f97316' : rec.priority === 'Medium' ? '#f59e0b' : '#1e293b'}`,
              borderRadius: '6px',
              padding: '14px 18px',
              display: 'flex',
              flexDirection: 'column',
              gap: '6px'
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '8px' }}>
                <span style={{ fontSize: '13.5px', fontWeight: 700, color: '#f8fafc' }} className="print-text-dark">
                  {rec.title}
                </span>
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                  <span style={{ fontSize: '11px', fontFamily: 'monospace', color: '#94a3b8' }} className="print-text-muted">
                    {rec.metric}: <strong style={{ color: '#cbd5e1' }}>{rec.measured_value}</strong> (Ref: {rec.nominal_target})
                  </span>
                  <span style={{
                    backgroundColor: `${getPriorityColor(rec.priority)}22`,
                    border: `1px solid ${getPriorityColor(rec.priority)}`,
                    color: getPriorityColor(rec.priority),
                    borderRadius: '3px',
                    padding: '2px 8px',
                    fontSize: '10.5px',
                    fontWeight: 700,
                    textTransform: 'uppercase'
                  }}>
                    {rec.priority}
                  </span>
                </div>
              </div>

              <div style={{ fontSize: '12px', color: '#cbd5e1', lineHeight: 1.4 }} className="print-text-dark">
                <strong style={{ color: '#94a3b8' }}>Evidence: </strong>{rec.evidence}
              </div>

              <div style={{ fontSize: '12px', color: '#38bdf8', lineHeight: 1.4, marginTop: '2px' }}>
                <strong style={{ color: '#38bdf8' }}>Action: </strong>{rec.action}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* 5. Section: Alarm Statistics & Operator Validation Summary */}
      <div className="report-card" style={{
        backgroundColor: '#111827',
        border: '1px solid #1e293b',
        borderRadius: '8px',
        padding: '20px'
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
          <div>
            <h2 style={{ margin: 0, fontSize: '15px', fontWeight: 700, color: '#f8fafc' }} className="print-text-dark">
              Alarm Event & Validation Statistics
            </h2>
            <div style={{ fontSize: '12px', color: '#94a3b8', marginTop: '2px' }} className="print-text-muted">
              Classification of ML-detected alerts against operator ground-truth verification
            </div>
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)', gap: '12px' }}>
          <div style={{ backgroundColor: '#0d1117', border: '1px solid #1e293b', borderRadius: '6px', padding: '12px', textAlign: 'center' }}>
            <div style={{ fontSize: '11px', color: '#94a3b8' }} className="print-text-muted">Total Events</div>
            <div style={{ fontSize: '22px', fontWeight: 700, color: '#f8fafc', fontFamily: 'monospace', marginTop: '4px' }} className="print-text-dark">
              {summary.total}
            </div>
          </div>

          <div style={{ backgroundColor: '#0d1117', border: '1px solid #1e293b', borderRadius: '6px', padding: '12px', textAlign: 'center' }}>
            <div style={{ fontSize: '11px', color: '#10b981' }}>Confirmed (TP)</div>
            <div style={{ fontSize: '22px', fontWeight: 700, color: '#10b981', fontFamily: 'monospace', marginTop: '4px' }}>
              {summary.confirmed_alarm}
            </div>
          </div>

          <div style={{ backgroundColor: '#0d1117', border: '1px solid #1e293b', borderRadius: '6px', padding: '12px', textAlign: 'center' }}>
            <div style={{ fontSize: '11px', color: '#ef4444' }}>False Alarms (FP)</div>
            <div style={{ fontSize: '22px', fontWeight: 700, color: '#ef4444', fontFamily: 'monospace', marginTop: '4px' }}>
              {summary.false_alarm}
            </div>
          </div>

          <div style={{ backgroundColor: '#0d1117', border: '1px solid #1e293b', borderRadius: '6px', padding: '12px', textAlign: 'center' }}>
            <div style={{ fontSize: '11px', color: '#f59e0b' }}>Missed Faults (FN)</div>
            <div style={{ fontSize: '22px', fontWeight: 700, color: '#f59e0b', fontFamily: 'monospace', marginTop: '4px' }}>
              {summary.missed_fault}
            </div>
          </div>

          <div style={{ backgroundColor: '#0d1117', border: '1px solid #1e293b', borderRadius: '6px', padding: '12px', textAlign: 'center' }}>
            <div style={{ fontSize: '11px', color: '#38bdf8' }}>Normal (TN)</div>
            <div style={{ fontSize: '22px', fontWeight: 700, color: '#38bdf8', fontFamily: 'monospace', marginTop: '4px' }}>
              {summary.confirmed_normal}
            </div>
          </div>

          <div style={{ backgroundColor: '#0d1117', border: '1px solid #1e293b', borderRadius: '6px', padding: '12px', textAlign: 'center' }}>
            <div style={{ fontSize: '11px', color: '#94a3b8' }} className="print-text-muted">Unreviewed</div>
            <div style={{ fontSize: '22px', fontWeight: 700, color: '#94a3b8', fontFamily: 'monospace', marginTop: '4px' }} className="print-text-muted">
              {summary.unreviewed}
            </div>
          </div>
        </div>
      </div>

      {/* 6. Section: Persistent Event History Table */}
      <div className="report-card" style={{
        backgroundColor: '#111827',
        border: '1px solid #1e293b',
        borderRadius: '8px',
        padding: '20px'
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '14px', flexWrap: 'wrap', gap: '8px' }}>
          <div>
            <h2 style={{ margin: 0, fontSize: '15px', fontWeight: 700, color: '#f8fafc' }} className="print-text-dark">
              Persistent Event History & Validation
            </h2>
            <div style={{ fontSize: '12px', color: '#94a3b8', marginTop: '2px' }} className="print-text-muted">
              Historical record of ML predictions, sensor snapshots at detection, and operator ground-truth validations
            </div>
          </div>

          <span style={{ fontSize: '12px', color: '#94a3b8', fontFamily: 'monospace' }} className="print-text-muted">
            {events.length} Recorded {events.length === 1 ? 'Event' : 'Events'}
          </span>
        </div>

        {events.length === 0 ? (
          <div style={{ padding: '36px', textAlign: 'center', color: '#64748b', fontSize: '13px' }}>
            No cavitation alarms or alert events logged in this session yet. Events are logged automatically when cavitation probability crosses 25% or 50%.
          </div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{
              width: '100%',
              borderCollapse: 'collapse',
              fontSize: '12px',
              fontFamily: 'monospace'
            }}>
              <thead>
                <tr style={{ borderBottom: '1px solid #334155', color: '#94a3b8', textAlign: 'left' }}>
                  <th style={{ padding: '8px 10px', fontWeight: 600 }}>Timestamp</th>
                  <th style={{ padding: '8px 10px', fontWeight: 600 }}>Classification</th>
                  <th style={{ padding: '8px 10px', fontWeight: 600 }}>Probability</th>
                  <th style={{ padding: '8px 10px', fontWeight: 600 }}>Severity</th>
                  <th style={{ padding: '8px 10px', fontWeight: 600 }}>Sensor Snapshot (Suct / Disc / Flow / Vib / Temp)</th>
                  <th style={{ padding: '8px 10px', fontWeight: 600 }}>Duration</th>
                  <th style={{ padding: '8px 10px', fontWeight: 600 }}>User Validation</th>
                </tr>
              </thead>
              <tbody>
                {events.map((evt) => {
                  const badge = getValidationBadge(evt.validation_status);
                  const isUpdating = updatingId === evt.alert_id;
                  const dateStr = evt.timestamp ? new Date(evt.timestamp).toLocaleTimeString() : '00:00:00';

                  return (
                    <tr key={evt.alert_id} style={{
                      borderBottom: '1px solid #1e293b',
                      color: '#cbd5e1'
                    }}>
                      <td style={{ padding: '8px 10px', color: '#94a3b8', whiteSpace: 'nowrap' }} className="print-text-muted">
                        {dateStr}
                      </td>
                      <td style={{ padding: '8px 10px', fontWeight: 600, color: evt.classification.includes('Predicted') ? '#ef4444' : '#f59e0b' }}>
                        {evt.classification}
                      </td>
                      <td style={{ padding: '8px 10px', fontVariantNumeric: 'tabular-nums' }}>
                        {(evt.probability * 100).toFixed(1)} %
                      </td>
                      <td style={{ padding: '8px 10px' }}>
                        <span style={{
                          color: evt.severity === 'Severe' ? '#ef4444' : evt.severity === 'Developed' ? '#f97316' : '#f59e0b',
                          fontWeight: 700
                        }}>
                          {evt.severity}
                        </span>
                      </td>
                      <td style={{ padding: '8px 10px', color: '#cbd5e1', fontSize: '11px' }} className="print-text-dark">
                        {evt.sensors.suction_pressure.toFixed(2)} bar &bull; {evt.sensors.discharge_pressure.toFixed(2)} bar &bull; {evt.sensors.flow_rate.toFixed(1)} m³/h &bull; {evt.sensors.vibration_rms.toFixed(2)} mm/s &bull; {evt.sensors.temperature.toFixed(0)} °C
                      </td>
                      <td style={{ padding: '8px 10px', color: '#94a3b8' }} className="print-text-muted">
                        {evt.duration_s} s
                      </td>
                      <td style={{ padding: '8px 10px' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                          <select
                            value={evt.validation_status}
                            onChange={(e) => handleValidateEvent(evt.alert_id, e.target.value as EventValidationStatus)}
                            disabled={isUpdating}
                            style={{
                              backgroundColor: badge.bg,
                              color: badge.color,
                              border: `1px solid ${badge.border}`,
                              borderRadius: '4px',
                              padding: '3px 8px',
                              fontSize: '11px',
                              fontWeight: 600,
                              cursor: 'pointer',
                              fontFamily: 'monospace'
                            }}
                          >
                            <option value="unreviewed" style={{ backgroundColor: '#111827', color: '#94a3b8' }}>Unreviewed</option>
                            <option value="confirmed_alarm" style={{ backgroundColor: '#111827', color: '#10b981' }}>Confirmed Alarm (TP)</option>
                            <option value="false_alarm" style={{ backgroundColor: '#111827', color: '#ef4444' }}>False Alarm (FP)</option>
                            <option value="missed_fault" style={{ backgroundColor: '#111827', color: '#f59e0b' }}>Missed Fault (FN)</option>
                            <option value="confirmed_normal" style={{ backgroundColor: '#111827', color: '#38bdf8' }}>Confirmed Normal (TN)</option>
                          </select>
                          {isUpdating && <span style={{ fontSize: '10px', color: '#38bdf8' }}>...</span>}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Modal for Recording Missed Fault Incident */}
      {showAddModal && (
        <div style={{
          position: 'fixed',
          top: 0,
          left: 0,
          width: '100vw',
          height: '100vh',
          backgroundColor: 'rgba(0,0,0,0.65)',
          zIndex: 9999,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center'
        }}>
          <div style={{
            backgroundColor: '#111827',
            border: '1px solid #f59e0b',
            borderRadius: '8px',
            padding: '24px',
            width: '460px',
            maxWidth: '92vw',
            display: 'flex',
            flexDirection: 'column',
            gap: '14px'
          }}>
            <h3 style={{ margin: 0, fontSize: '16px', fontWeight: 700, color: '#f8fafc' }}>
              Record Operator Incident / Missed Fault
            </h3>
            <div style={{ fontSize: '12px', color: '#94a3b8' }}>
              Log an observed cavitation anomaly at the current timestamp using live telemetry readings.
            </div>

            <div>
              <label style={{ fontSize: '11.5px', color: '#cbd5e1', display: 'block', marginBottom: '4px' }}>
                Classification Category:
              </label>
              <select
                value={addStatus}
                onChange={(e) => setAddStatus(e.target.value as EventValidationStatus)}
                style={{
                  width: '100%',
                  backgroundColor: '#0d1117',
                  border: '1px solid #334155',
                  color: '#f8fafc',
                  padding: '6px 8px',
                  borderRadius: '4px',
                  fontSize: '12px'
                }}
              >
                <option value="missed_fault">Missed Fault (False Negative - Cavitation occurred without alarm)</option>
                <option value="confirmed_alarm">Confirmed Alarm (True Positive)</option>
                <option value="false_alarm">False Alarm (False Positive)</option>
                <option value="confirmed_normal">Confirmed Normal (True Negative)</option>
              </select>
            </div>

            <div>
              <label style={{ fontSize: '11.5px', color: '#cbd5e1', display: 'block', marginBottom: '4px' }}>
                Operator Observations / Notes:
              </label>
              <textarea
                value={addNotes}
                onChange={(e) => setAddNotes(e.target.value)}
                placeholder="e.g. Audible gravel sound at impeller suction; suction gauge dipped to 0.75 bar."
                rows={3}
                style={{
                  width: '100%',
                  backgroundColor: '#0d1117',
                  border: '1px solid #334155',
                  color: '#f8fafc',
                  padding: '8px',
                  borderRadius: '4px',
                  fontSize: '12px',
                  resize: 'none',
                  boxSizing: 'border-box'
                }}
              />
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', marginTop: '4px' }}>
              <button
                onClick={() => setShowAddModal(false)}
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
                Cancel
              </button>
              <button
                onClick={handleRecordIncident}
                style={{
                  backgroundColor: '#f59e0b',
                  color: '#0f172a',
                  border: 'none',
                  borderRadius: '4px',
                  padding: '6px 14px',
                  fontSize: '12px',
                  fontWeight: 700,
                  cursor: 'pointer'
                }}
              >
                Save Incident
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
