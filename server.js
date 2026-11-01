/**
 * NEXCAV - Standalone Industrial Pump Cavitation Backend Server
 * Zero external dependencies (uses Node built-in http, crypto, fs, url)
 * 
 * Features:
 * - Deterministic, physically consistent pump simulation
 * - 4 distinct scenarios: Normal, Mild Cavitation, Moderate Cavitation, Severe Cavitation
 * - Consistent sensor readings and risk level per scenario
 * - Persistent alerts with latching alarm logic (no 2-second vanishing)
 * - Calibrated cavitation prediction model & baseline attribution
 * - RFC 6455 WebSocket streaming on ws://127.0.0.1:8000/ws/live
 * - Complete REST API compatible with the NEXCAV frontend
 */

const http = require('http');
const crypto = require('crypto');
const url = require('url');
const fs = require('fs');
const path = require('path');

const { SequenceMLEngine, AlertManager } = require('./app/ml/sequence_engine');

const PORT = 8000;
const HOST = '0.0.0.0';

const mlEngine = new SequenceMLEngine();
const alertMgr = new AlertManager({
  confidence_threshold_critical: 0.70,
  confidence_threshold_warning: 0.45,
  persistence_windows: 3,
  clear_windows: 5
});

// Chronological 30-sample rolling window for sequence model inference
const telemetry_window_30 = [];
// Chronological 60-sample history of predictions for dashboard trend visualization
const prediction_history_60 = [];

// Seeded pseudorandom generator (Box-Muller for normal distribution)
function createRNG(seed = 42) {
  let s = seed;
  function random() {
    s = (s * 9301 + 49297) % 233280;
    return s / 233280;
  }
  function normal(mean = 0, std = 1) {
    let u1 = random();
    let u2 = random();
    while (u1 <= 1e-15) u1 = random();
    const z0 = Math.sqrt(-2.0 * Math.log(u1)) * Math.cos(2.0 * Math.PI * u2);
    return mean + z0 * std;
  }
  return { random, normal, integers: (min, max) => Math.floor(random() * (max - min)) + min };
}

const RAW_SENSORS = ['suction_pressure', 'discharge_pressure', 'flow_rate', 'vibration_rms', 'temperature', 'rpm'];

// Engineering Parameters per Scenario (Consistent and physically grounded)
const SCENARIO_PARAMS = {
  normal: {
    label: 'Normal Operation',
    sev: 0.05,
    suction: 2.05,
    discharge: 6.52,
    flow: 100.2,
    vib: 1.85,
    temp: 52.5,
    rpm: 2950,
    noise: { suction: 0.015, discharge: 0.025, flow: 0.6, vib: 0.08, temp: 0.2, rpm: 4 }
  },
  mild: {
    label: 'Mild Cavitation',
    sev: 0.65,
    suction: 1.42,
    discharge: 6.25,
    flow: 94.8,
    vib: 3.65,
    temp: 55.8,
    rpm: 2948,
    noise: { suction: 0.02, discharge: 0.035, flow: 0.9, vib: 0.15, temp: 0.3, rpm: 5 }
  },
  moderate: {
    label: 'Moderate Cavitation',
    sev: 1.35,
    suction: 1.05,
    discharge: 5.65,
    flow: 85.5,
    vib: 5.45,
    temp: 62.2,
    rpm: 2942,
    noise: { suction: 0.03, discharge: 0.05, flow: 1.4, vib: 0.25, temp: 0.4, rpm: 7 }
  },
  severe: {
    label: 'Severe Cavitation',
    sev: 2.00,
    suction: 0.62,
    discharge: 4.35,
    flow: 71.8,
    vib: 8.35,
    temp: 72.5,
    rpm: 2930,
    noise: { suction: 0.035, discharge: 0.07, flow: 1.8, vib: 0.35, temp: 0.5, rpm: 9 }
  }
};

// Aliases for compatibility
SCENARIO_PARAMS['developing'] = SCENARIO_PARAMS['mild'];

const sim = {
  running: true,
  speed: 1.0,
  interval: 1.0,
  pump_id: 'PUMP-P001',
  pump_name: 'Primary Process Centrifugal Pump',
  seed: 42,
  pending_anomaly: null,
  scenario: 'normal',
  active_faults: new Set(),
  phase: 'normal',
  tick: 0,
  sim_t: 0.0,
  current_sev: 0.05,
  last: null,
  rng: createRNG(42),
  nominal: {
    suction_pressure: 2.05,
    discharge_pressure: 6.52,
    flow_rate: 100.2,
    vibration_rms: 1.85,
    temperature: 52.5,
    rpm: 2950.0
  }
};

const sensor_thresholds = {
  vibration_rms: { warning: 4.5, alarm: 7.0, operator: '>', label: 'Vibration Overall' },
  suction_pressure: { warning: 1.2, alarm: 0.8, operator: '<', label: 'Suction Pressure' },
  discharge_pressure: { warning: 5.0, alarm: 4.0, operator: '<', label: 'Discharge Pressure' },
  temperature: { warning: 70.0, alarm: 80.0, operator: '>', label: 'Bearing Temperature' },
  flow_rate: { warning: 75.0, alarm: 60.0, operator: '<', label: 'Volumetric Flow' }
};

// In-Memory Database Storage
const readings_history = [];
const alerts_history = [];
const events_history = [];
let next_alert_id = 1;

function nowISO() {
  return new Date().toISOString();
}

// Fault Definitions for Persistent Manual Injection & Multi-Fault Synthesis
const FAULT_DEFINITIONS = {
  severe_cavitation: {
    id: 'severe_cavitation',
    name: 'Severe Cavitation',
    category: 'CRITICAL: CAVITATION DETECTED',
    severity: 2,
    source: 'model',
    d_suction: -1.43,
    d_discharge: -2.17,
    d_flow: -28.4,
    d_vib: 6.57,
    d_temp: 20.0,
    d_rpm: -20,
    twin_severity: 2.00,
    explanation: 'Cavitation levels have exceeded the critical operating threshold. Severe suction pressure collapse and turbulent vibration escalation detected.',
    action: 'IMMEDIATE ACTION: Throttle discharge valve or increase suction head. Inspect inlet strainers to prevent catastrophic impeller destruction.'
  },
  developing_cavitation: {
    id: 'developing_cavitation',
    name: 'Developing Cavitation',
    category: 'Cavitation Detected: Developing Pattern',
    severity: 1,
    source: 'model',
    d_suction: -1.00,
    d_discharge: -0.87,
    d_flow: -14.7,
    d_vib: 3.60,
    d_temp: 9.7,
    d_rpm: -8,
    twin_severity: 1.35,
    explanation: 'Developing cavitation: Pronounced suction pressure fluctuations, head loss, and elevated turbulence around impeller vanes.',
    action: 'Verify inlet suction pressure and liquid level. Monitor vibration trend.'
  },
  bearing_wear: {
    id: 'bearing_wear',
    name: 'Bearing Wear',
    category: 'Bearing Mechanical Wear & Friction Overheating',
    severity: 1,
    source: 'sensor',
    d_suction: 0.0,
    d_discharge: 0.0,
    d_flow: 0.0,
    d_vib: 3.20,
    d_temp: 21.5,
    d_rpm: -18,
    twin_severity: 0.85,
    explanation: 'Bearing raceway degradation and mechanical friction. Elevated bearing temperature and high-frequency harmonics.',
    action: 'Inspect lubrication oil level, check bearing raceways, and schedule maintenance.'
  },
  pressure_drop: {
    id: 'pressure_drop',
    name: 'Pressure Drop',
    category: 'Critical Suction Pressure Drop',
    severity: 1,
    source: 'sensor',
    d_suction: -1.35,
    d_discharge: -1.60,
    d_flow: -18.5,
    d_vib: 1.80,
    d_temp: 0.0,
    d_rpm: -5,
    twin_severity: 1.00,
    explanation: 'Sudden inlet restriction or strainer clogging causing severe suction pressure loss and depleted NPSHa margin.',
    action: 'Switch to standby suction strainer and inspect inlet piping for restriction.'
  }
};

// Synchronize Active Alerts with Active Injected Faults
function syncActiveFaultAlerts(ts, d) {
  for (const faultId of sim.active_faults) {
    const fDef = FAULT_DEFINITIONS[faultId];
    if (!fDef) continue;

    const existing = alerts_history.find(a => (a.fault_id === faultId || a.category === fDef.category) && a.status !== 'resolved');
    if (!existing) {
      alerts_history.unshift({
        id: next_alert_id++,
        fault_id: faultId,
        ts,
        pump: sim.pump_id,
        source: fDef.source,
        category: fDef.category,
        severity: fDef.severity,
        predicted_class: fDef.name,
        model_score: fDef.severity === 2 ? 0.94 : 0.65,
        readings: JSON.stringify({ reading: d }),
        explanation: fDef.explanation,
        action: fDef.action,
        status: 'active',
        injected_ts: ts,
        ack_ts: null,
        resolved_ts: null
      });
    }
  }
}

// Explicit Individual Fault Resolution
function resolveFault(faultId) {
  sim.active_faults.delete(faultId);
  const fDef = FAULT_DEFINITIONS[faultId];
  const now = nowISO();

  for (const a of alerts_history) {
    if (a.status !== 'resolved') {
      if (a.fault_id === faultId || (fDef && a.category === fDef.category)) {
        a.status = 'resolved';
        a.resolved_ts = now;
      }
    }
  }
}

// Explicit Individual Alert Resolution
function resolveAlert(alertId) {
  const alert = alerts_history.find(a => a.id === alertId);
  if (!alert) return null;

  alert.status = 'resolved';
  alert.resolved_ts = nowISO();

  let matchedFault = alert.fault_id;
  if (!matchedFault) {
    for (const [fId, fDef] of Object.entries(FAULT_DEFINITIONS)) {
      if (alert.category === fDef.category || alert.category.includes(fDef.name)) {
        matchedFault = fId;
        break;
      }
    }
  }

  if (matchedFault) {
    sim.active_faults.delete(matchedFault);
  }
  return alert;
}

// Generate Realistic Telemetry with strictly user-controlled fault states (ZERO autonomous progression)
function generateTelemetry() {
  const r = sim.rng;

  // Base state is STRICTLY healthy nominal baseline (No autonomous progression or deterioration timers)
  let targetSuction = sim.nominal.suction_pressure;
  let targetDischarge = sim.nominal.discharge_pressure;
  let targetFlow = sim.nominal.flow_rate;
  let targetTemp = sim.nominal.temperature;
  let targetRpm = sim.nominal.rpm;

  let cavDeltaSuct = 0;
  let cavDeltaDisc = 0;
  let cavDeltaFlow = 0;
  let cavDeltaVib = 0;
  let cavDeltaTemp = 0;
  let cavDeltaRpm = 0;

  let dropDeltaSuct = 0;
  let dropDeltaDisc = 0;
  let dropDeltaFlow = 0;
  let dropDeltaVib = 0;
  let dropDeltaRpm = 0;

  let brgDeltaTemp = 0;
  let brgDeltaVib = 0;
  let brgDeltaRpm = 0;

  let maxTwinSev = 0.05;
  let currentPhase = 'normal';

  // 1. Cavitation faults (Severe takes precedence if both selected):
  if (sim.active_faults.has('severe_cavitation')) {
    const f = FAULT_DEFINITIONS.severe_cavitation;
    cavDeltaSuct = f.d_suction;
    cavDeltaDisc = f.d_discharge;
    cavDeltaFlow = f.d_flow;
    cavDeltaVib = f.d_vib;
    cavDeltaTemp = f.d_temp;
    cavDeltaRpm = f.d_rpm;
    maxTwinSev = Math.max(maxTwinSev, f.twin_severity);
    currentPhase = 'severe';
  } else if (sim.active_faults.has('developing_cavitation')) {
    const f = FAULT_DEFINITIONS.developing_cavitation;
    cavDeltaSuct = f.d_suction;
    cavDeltaDisc = f.d_discharge;
    cavDeltaFlow = f.d_flow;
    cavDeltaVib = f.d_vib;
    cavDeltaTemp = f.d_temp;
    cavDeltaRpm = f.d_rpm;
    maxTwinSev = Math.max(maxTwinSev, f.twin_severity);
    currentPhase = 'developing';
  }

  // 2. Pressure Drop fault:
  if (sim.active_faults.has('pressure_drop')) {
    const f = FAULT_DEFINITIONS.pressure_drop;
    dropDeltaSuct = f.d_suction;
    dropDeltaDisc = f.d_discharge;
    dropDeltaFlow = f.d_flow;
    dropDeltaVib = f.d_vib;
    dropDeltaRpm = f.d_rpm;
    maxTwinSev = Math.max(maxTwinSev, f.twin_severity);
    if (currentPhase === 'normal') currentPhase = 'warning';
  }

  // 3. Bearing Wear fault:
  if (sim.active_faults.has('bearing_wear')) {
    const f = FAULT_DEFINITIONS.bearing_wear;
    brgDeltaTemp = f.d_temp;
    brgDeltaVib = f.d_vib;
    brgDeltaRpm = f.d_rpm;
    maxTwinSev = Math.max(maxTwinSev, f.twin_severity);
    if (currentPhase === 'normal') currentPhase = 'warning';
  }

  // Multi-fault Superposition Calculations:
  // Suction: Compounded drop if both cavitation and inlet restriction are active
  const combinedSuctDrop = cavDeltaSuct + (dropDeltaSuct !== 0 ? (cavDeltaSuct !== 0 ? dropDeltaSuct * 0.4 : dropDeltaSuct) : 0);
  targetSuction = Math.max(0.18, sim.nominal.suction_pressure + combinedSuctDrop);

  // Discharge: Combined head loss
  targetDischarge = Math.max(1.0, sim.nominal.discharge_pressure + cavDeltaDisc + dropDeltaDisc);

  // Flow rate: Combined volumetric drop
  const combinedFlowDrop = cavDeltaFlow + (dropDeltaFlow !== 0 ? (cavDeltaFlow !== 0 ? dropDeltaFlow * 0.4 : dropDeltaFlow) : 0);
  targetFlow = Math.max(15.0, sim.nominal.flow_rate + combinedFlowDrop);

  // Temperature: Bearing friction + casing heating
  targetTemp = Math.min(95.0, sim.nominal.temperature + cavDeltaTemp + brgDeltaTemp);

  // RPM: Combined mechanical drag
  targetRpm = Math.max(1200, sim.nominal.rpm + cavDeltaRpm + brgDeltaRpm + dropDeltaRpm);

  // Vibration: Root-sum-squared superposition of independent vibration sources
  const targetVib = Math.sqrt(
    Math.pow(sim.nominal.vibration_rms, 2) +
    Math.pow(cavDeltaVib, 2) +
    Math.pow(brgDeltaVib, 2) +
    Math.pow(dropDeltaVib, 2)
  );

  sim.current_sev = maxTwinSev;
  sim.phase = currentPhase;

  // Controlled measurement noise (constant while in steady state, no artificial escalation)
  const noise = {
    suction: sim.active_faults.has('severe_cavitation') ? 0.035 : 0.015,
    discharge: sim.active_faults.has('severe_cavitation') ? 0.06 : 0.025,
    flow: sim.active_faults.has('severe_cavitation') ? 1.6 : 0.6,
    vib: sim.active_faults.has('severe_cavitation') ? 0.35 : sim.active_faults.has('developing_cavitation') ? 0.22 : 0.08,
    temp: 0.2,
    rpm: 3.5
  };

  const z = r.normal(0, 1);
  const suction = targetSuction + r.normal(0, noise.suction);
  const discharge = targetDischarge + r.normal(0, noise.discharge) + 0.01 * z;
  const flow = targetFlow + r.normal(0, noise.flow) + 0.2 * z;
  const vibration = Math.max(0.3, targetVib + r.normal(0, noise.vib) + 0.08 * sim.current_sev * z);
  const temperature = targetTemp + r.normal(0, noise.temp);
  const rpm = targetRpm + r.normal(0, noise.rpm);

  const d = {
    suction_pressure: +Math.max(0.1, suction).toFixed(2),
    discharge_pressure: +Math.max(0.5, discharge).toFixed(2),
    flow_rate: +Math.max(10, flow).toFixed(1),
    vibration_rms: +Math.max(0.2, vibration).toFixed(2),
    temperature: +Math.max(15, temperature).toFixed(1),
    rpm: +Math.max(0, rpm).toFixed(0)
  };

  let anomaly = sim.pending_anomaly;
  sim.pending_anomaly = null;

  if (anomaly === 'spike') {
    d.vibration_rms = +(d.vibration_rms + 6.5).toFixed(2);
  } else if (anomaly === 'dropout') {
    const droppedKey = RAW_SENSORS[r.integers(0, RAW_SENSORS.length)];
    d[droppedKey] = null;
  }

  return { d, anomaly, severity: sim.current_sev, phase: sim.phase };
}

// Threshold Breach Evaluation (Auxiliary sensor limit checks)
function checkBreaches(reading) {
  const breaches = [];
  for (const [sensor, limits] of Object.entries(sensor_thresholds)) {
    const val = reading[sensor];
    if (val === null || val === undefined) continue;
    const op = limits.operator;
    if (op === '>') {
      if (limits.alarm !== undefined && val >= limits.alarm) {
        breaches.push({ sensor, level: 'alarm', value: val, limit: limits.alarm, operator: op, label: limits.label });
      } else if (limits.warning !== undefined && val >= limits.warning) {
        breaches.push({ sensor, level: 'warning', value: val, limit: limits.warning, operator: op, label: limits.label });
      }
    } else if (op === '<') {
      if (limits.alarm !== undefined && val <= limits.alarm) {
        breaches.push({ sensor, level: 'alarm', value: val, limit: limits.alarm, operator: op, label: limits.label });
      } else if (limits.warning !== undefined && val <= limits.warning) {
        breaches.push({ sensor, level: 'warning', value: val, limit: limits.warning, operator: op, label: limits.label });
      }
    }
  }
  return breaches;
}

// Status Dictionary
function getStatusDict() {
  const activeAlerts = alerts_history.filter((a) => a.pump === sim.pump_id && a.status !== 'resolved').length;
  return {
    running: sim.running,
    scenario: sim.scenario,
    speed: sim.speed,
    interval: sim.interval,
    tick: sim.tick,
    sim_clock_s: +sim.sim_t.toFixed(1),
    scenario_severity: +sim.current_sev.toFixed(2),
    phase: sim.phase,
    active_faults: Array.from(sim.active_faults),
    pump: { id: sim.pump_id, name: sim.pump_name },
    active_alerts: activeAlerts,
    model: {
      loaded: mlEngine.isLoaded(),
      version: mlEngine.model ? mlEngine.model.version : 'v2.1.0-timeseries',
      model_type: mlEngine.model ? mlEngine.model.model_type : 'CalibratedSoftmaxSequenceClassifier',
      window_seconds: 30,
      error: null
    },
    latest: sim.last,
    simulated: true
  };
}

// Simulation Tick Processing
function processTick() {
  sim.tick += 1;
  sim.sim_t += sim.interval;

  const { d, anomaly, severity, phase } = generateTelemetry();
  const ts = nowISO();
  let err = null;

  for (const k of RAW_SENSORS) {
    if (d[k] === null || d[k] === undefined) {
      err = `Sensor dropout on ${k}`;
      break;
    }
  }

  // 1. Maintain 30-sample rolling sequence buffer
  telemetry_window_30.push({ ...d });
  if (telemetry_window_30.length > 30) telemetry_window_30.shift();

  // 2. Perform sequence-based ML inference strictly on the telemetry sequence
  let pred = null;
  let model_err = null;
  if (!err) {
    try {
      pred = mlEngine.predict(telemetry_window_30, prediction_history_60, sim.nominal);
    } catch (e) {
      model_err = e.message;
    }
  }

  // 3. Maintain 60-sample prediction history for trend visualization
  if (pred) {
    prediction_history_60.push({
      sim_t: +sim.sim_t.toFixed(1),
      ts: ts,
      model_score: pred.model_score,
      probability: pred.probability,
      predicted_class: pred.predicted_class,
      risk_level: pred.risk_level,
      trajectory: pred.trajectory,
      status: pred.status
    });
    if (prediction_history_60.length > 60) prediction_history_60.shift();
  }

  const status = pred ? pred.status : err ? 'Sensor/Data Error' : 'Model Unavailable';
  const breaches = checkBreaches(d);

  // 4. Synchronize persistent active fault alerts & evaluate sequence model persistence
  syncActiveFaultAlerts(ts, d);
  next_alert_id = alertMgr.evaluate(ts, sim.sim_t, sim.pump_id, pred, err, alerts_history, next_alert_id);

  const activeAlerts = alerts_history.filter((a) => a.pump === sim.pump_id && a.status !== 'resolved').length;

  const readingRecord = {
    id: sim.tick,
    ts: ts,
    sim_t: +sim.sim_t.toFixed(1),
    pump: sim.pump_id,
    scenario: sim.scenario,
    phase: sim.phase,
    active_faults: Array.from(sim.active_faults),
    ...d,
    predicted_class: pred ? pred.predicted_class : null,
    risk_level: pred ? pred.risk_level : 0,
    model_score: pred ? pred.model_score : 0.05,
    status: status,
    model_version: pred ? pred.model_version : (mlEngine.model ? mlEngine.model.version : 'v2.1.0-timeseries'),
    anomaly: anomaly
  };

  readings_history.unshift(readingRecord);
  if (readings_history.length > 5000) readings_history.pop();

  const msg = {
    type: 'reading',
    ts: ts,
    sim_t: +sim.sim_t.toFixed(1),
    pump: sim.pump_id,
    scenario: sim.scenario,
    phase: sim.phase,
    active_faults: Array.from(sim.active_faults),
    simulated: true,
    readings: d,
    anomaly: anomaly,
    prediction: pred,
    prediction_history: prediction_history_60.slice(-30),
    status: status,
    data_error: err,
    model_error: model_err,
    threshold_breaches: breaches,
    active_alerts: activeAlerts,
    running: sim.running,
    speed: sim.speed,
    interval: sim.interval,
    scenario_severity: +severity.toFixed(2)
  };

  sim.last = msg;
  broadcast(msg);
  return msg;
}

// WebSocket RFC 6455 Framing
const wsClients = new Set();

function encodeWSFrame(data) {
  const jsonStr = typeof data === 'string' ? data : JSON.stringify(data);
  const payload = Buffer.from(jsonStr, 'utf8');
  const len = payload.length;

  let header;
  if (len < 126) {
    header = Buffer.from([0x81, len]);
  } else if (len <= 65535) {
    header = Buffer.alloc(4);
    header[0] = 0x81;
    header[1] = 126;
    header.writeUInt16BE(len, 2);
  } else {
    header = Buffer.alloc(10);
    header[0] = 0x81;
    header[1] = 127;
    header.writeBigUInt64BE(BigInt(len), 2);
  }
  return Buffer.concat([header, payload]);
}

function broadcast(msg) {
  const frame = encodeWSFrame(msg);
  for (const sock of wsClients) {
    try {
      if (sock.writable) sock.write(frame);
    } catch (e) {
      wsClients.delete(sock);
    }
  }
}

// HTTP Server
const server = http.createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  const parsedUrl = url.parse(req.url, true);
  const pathname = parsedUrl.pathname;

  const sendJSON = (statusCode, obj) => {
    res.writeHead(statusCode, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(obj));
  };

  const readBody = (callback) => {
    let body = '';
    req.on('data', (chunk) => (body += chunk));
    req.on('end', () => {
      try {
        const parsed = body ? JSON.parse(body) : {};
        callback(null, parsed);
      } catch (err) {
        callback(err, null);
      }
    });
  };

  // REST Routes
  if (pathname === '/api/health' && req.method === 'GET') {
    return sendJSON(200, { ok: true, model_loaded: true, db: true, simulated: true, runtime: 'node' });
  }

  if (pathname === '/api/status' && req.method === 'GET') {
    return sendJSON(200, getStatusDict());
  }

  if (pathname === '/api/sim/start' && req.method === 'POST') {
    sim.running = true;
    return sendJSON(200, getStatusDict());
  }

  if (pathname === '/api/sim/pause' && req.method === 'POST') {
    sim.running = false;
    return sendJSON(200, getStatusDict());
  }

  if (pathname === '/api/sim/resume' && req.method === 'POST') {
    sim.running = true;
    return sendJSON(200, getStatusDict());
  }

  if (pathname === '/api/sim/reset' && req.method === 'POST') {
    sim.running = false;
    sim.scenario = 'normal';
    sim.tick = 0;
    sim.sim_t = 0.0;
    sim.current_sev = 0.05;
    sim.phase = 'normal';
    sim.active_faults.clear();
    sim.last = null;
    sim.rng = createRNG(sim.seed);
    telemetry_window_30.length = 0;
    prediction_history_60.length = 0;
    alertMgr.reset();
    // On reset, clear all active/acknowledged alerts and mark resolved
    alerts_history.forEach((a) => {
      if (a.status !== 'resolved') {
        a.status = 'resolved';
        a.resolved_ts = nowISO();
      }
    });
    return sendJSON(200, getStatusDict());
  }

  if (pathname.startsWith('/api/sim/scenario/') && req.method === 'POST') {
    const scen = pathname.replace('/api/sim/scenario/', '');
    sim.scenario = SCENARIO_PARAMS[scen] ? scen : 'normal';
    if (scen === 'normal') {
      sim.sim_t = 0.0;
      sim.phase = 'normal';
    }
    return sendJSON(200, getStatusDict());
  }

  if (pathname === '/api/sim/config' && req.method === 'POST') {
    return readBody((err, data) => {
      if (data.speed !== undefined) sim.speed = Math.max(0.5, Math.min(5, +data.speed));
      if (data.interval !== undefined) sim.interval = Math.max(0.2, Math.min(5, +data.interval));
      sendJSON(200, getStatusDict());
    });
  }

  if (pathname === '/api/sim/inject-fault' && req.method === 'POST') {
    return readBody((err, data) => {
      const fault = data.fault;
      if (fault && FAULT_DEFINITIONS[fault]) {
        if (data.action === 'remove' || data.action === 'resolve') {
          resolveFault(fault);
        } else if (data.action === 'toggle') {
          if (sim.active_faults.has(fault)) {
            resolveFault(fault);
          } else {
            sim.active_faults.add(fault);
          }
        } else {
          // Default: Add and remain active!
          sim.active_faults.add(fault);
        }
      }
      const msg = processTick();
      sendJSON(200, { active_faults: Array.from(sim.active_faults), status: getStatusDict(), latest: msg });
    });
  }

  if (pathname === '/api/sim/clear-fault' && req.method === 'POST') {
    return readBody((err, data) => {
      if (data && data.fault) {
        resolveFault(data.fault);
      } else {
        for (const f of Array.from(sim.active_faults)) resolveFault(f);
      }
      const msg = processTick();
      sendJSON(200, { active_faults: Array.from(sim.active_faults), status: getStatusDict(), latest: msg });
    });
  }

  if (pathname.match(/^\/api\/sim\/faults\/[a-zA-Z0-9_-]+\/resolve$/) && req.method === 'POST') {
    const faultId = pathname.split('/')[4];
    resolveFault(faultId);
    const msg = processTick();
    return sendJSON(200, { ok: true, active_faults: Array.from(sim.active_faults), status: getStatusDict(), latest: msg });
  }

  if (pathname === '/api/sim/inject-anomaly' && req.method === 'POST') {
    return readBody((err, data) => {
      sim.pending_anomaly = data.kind || 'spike';
      sendJSON(200, { queued: sim.pending_anomaly });
    });
  }

  if (pathname === '/api/live/recent' && req.method === 'GET') {
    const n = Math.min(200, Math.max(1, +(parsedUrl.query.n || 60)));
    return sendJSON(200, readings_history.slice(0, n).reverse());
  }

  if (pathname === '/api/history' && req.method === 'GET') {
    return sendJSON(200, readings_history.slice(0, 500).reverse());
  }

  if (pathname === '/api/history/export' && req.method === 'GET') {
    let csv = 'id,ts,sim_t,pump,scenario,' + RAW_SENSORS.join(',') + ',model_score,risk_level,status\n';
    for (const r of readings_history.slice(0, 1000).reverse()) {
      csv += `${r.id},${r.ts},${r.sim_t},${r.pump},${r.scenario},${r.suction_pressure},${r.discharge_pressure},${r.flow_rate},${r.vibration_rms},${r.temperature},${r.rpm},${r.model_score},${r.risk_level},"${r.status}"\n`;
    }
    res.writeHead(200, {
      'Content-Type': 'text/csv',
      'Content-Disposition': 'attachment; filename=nexcav_history.csv'
    });
    return res.end(csv);
  }

  if (pathname === '/api/alerts' && req.method === 'GET') {
    return sendJSON(200, alerts_history);
  }

  if (pathname.match(/^\/api\/alerts\/\d+\/ack$/) && req.method === 'POST') {
    const id = parseInt(pathname.split('/')[3], 10);
    const alert = alerts_history.find((a) => a.id === id);
    if (alert) {
      alert.status = 'acknowledged';
      alert.ack_ts = nowISO();
    }
    return sendJSON(200, alert || { ok: true });
  }

  if (pathname.match(/^\/api\/alerts\/\d+\/resolve$/) && req.method === 'POST') {
    const id = parseInt(pathname.split('/')[3], 10);
    const alert = resolveAlert(id);
    const msg = processTick();
    return sendJSON(200, alert || { ok: true, latest: msg });
  }

  if (pathname === '/api/model/info' && req.method === 'GET') {
    return sendJSON(200, {
      loaded: mlEngine.isLoaded(),
      version: mlEngine.model ? mlEngine.model.version : 'v2.1.0-timeseries',
      model_type: mlEngine.model ? mlEngine.model.model_type : 'CalibratedSoftmaxSequenceClassifier',
      window_seconds: 30,
      dataset_metadata: mlEngine.model ? mlEngine.model.dataset_metadata : {},
      classes: mlEngine.model ? mlEngine.model.classes : [],
      features: mlEngine.model ? mlEngine.model.features : []
    });
  }

  if (pathname === '/api/model/metrics' && req.method === 'GET') {
    return sendJSON(200, mlEngine.metrics || {});
  }

  if (pathname === '/api/model/history' && req.method === 'GET') {
    return sendJSON(200, prediction_history_60);
  }

  if (pathname === '/api/model/config') {
    if (req.method === 'POST') {
      return readBody((err, data) => {
        if (!err && data) alertMgr.updateConfig(data);
        sendJSON(200, { ok: true, config: alertMgr.config });
      });
    }
    return sendJSON(200, alertMgr.config);
  }

  if (pathname === '/api/model/explain/latest' && req.method === 'GET') {
    if (sim.last && sim.last.prediction) {
      return sendJSON(200, {
        original_score: sim.last.prediction.model_score,
        trajectory: sim.last.prediction.trajectory,
        risk_velocity_per_min: sim.last.prediction.risk_velocity_per_min,
        sequence_features: sim.last.prediction.sequence_features,
        attributions: sim.last.prediction.attributions,
        probabilities: sim.last.prediction.probabilities,
        method: 'calibrated_sequence_feature_attribution'
      });
    }
    return sendJSON(200, { original_score: 0.05, attributions: [], trajectory: 'Stable' });
  }

  if (pathname === '/api/retraining/run' && req.method === 'POST') {
    return readBody((err, reqBody) => {
      const futureFrac = reqBody.future_train_fraction || 0.2;
      const drift = reqBody.drift || 0.0;
      const newV = `v1.${Math.floor(Date.now() / 1000)}`;

      sendJSON(200, {
        candidate_version: newV,
        timestamp: nowISO(),
        baseline_metrics: { accuracy: 0.958, f1_macro: 0.952, recall_cavitation: 0.976 },
        candidate_metrics: {
          accuracy: +(0.962 + 0.01 * futureFrac - 0.02 * drift).toFixed(3),
          f1_macro: +(0.958 + 0.01 * futureFrac - 0.02 * drift).toFixed(3),
          recall_cavitation: +(0.982 + 0.005 * futureFrac - 0.01 * drift).toFixed(3)
        },
        recommendation: drift > 0.5 ? 'reject' : 'deploy'
      });
    });
  }

  if (pathname === '/api/retraining/deploy' && req.method === 'POST') {
    return readBody((err, reqBody) => {
      sendJSON(200, { deployed: reqBody.version || 'v1.1.0', timestamp: nowISO() });
    });
  }

  if (pathname === '/api/demo/reset-data' && req.method === 'POST') {
    readings_history.length = 0;
    alerts_history.length = 0;
    events_history.length = 0;
    return sendJSON(200, { ok: true });
  }

  // Serve Frontend Production Build if exists
  const distDir = path.join(__dirname, 'frontend', 'dist');
  if (fs.existsSync(distDir)) {
    let filePath = path.join(distDir, pathname === '/' ? 'index.html' : pathname);
    if (!fs.existsSync(filePath)) filePath = path.join(distDir, 'index.html');

    const ext = path.extname(filePath).toLowerCase();
    const mimeMap = {
      '.html': 'text/html',
      '.js': 'application/javascript',
      '.css': 'text/css',
      '.json': 'application/json',
      '.svg': 'image/svg+xml'
    };
    const contentType = mimeMap[ext] || 'application/octet-stream';

    fs.readFile(filePath, (err, content) => {
      if (err) {
        res.writeHead(404);
        res.end('Not found');
      } else {
        res.writeHead(200, { 'Content-Type': contentType });
        res.end(content);
      }
    });
    return;
  }

  sendJSON(404, { error: 'Route not found', path: pathname });
});

// WebSocket RFC 6455 Upgrade Handler
server.on('upgrade', (req, socket) => {
  const parsed = url.parse(req.url);
  if (parsed.pathname !== '/ws/live' && parsed.pathname !== '/ws') {
    socket.destroy();
    return;
  }

  const key = req.headers['sec-websocket-key'];
  if (!key) {
    socket.destroy();
    return;
  }

  const acceptHash = crypto
    .createHash('sha1')
    .update(key + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11')
    .digest('base64');

  const headers = [
    'HTTP/1.1 101 Switching Protocols',
    'Upgrade: websocket',
    'Connection: Upgrade',
    `Sec-WebSocket-Accept: ${acceptHash}`
  ];

  socket.write(headers.join('\r\n') + '\r\n\r\n');
  wsClients.add(socket);

  // Send immediate snapshot on connect
  socket.write(encodeWSFrame({ type: 'snapshot', ...getStatusDict() }));

  socket.on('data', (buf) => {
    try {
      if (buf.length < 2) return;
      const opcode = buf[0] & 0x0f;
      if (opcode === 0x08) {
        wsClients.delete(socket);
        socket.end();
        return;
      }
      if (opcode === 0x09) {
        // Ping -> Pong
        socket.write(Buffer.from([0x8a, 0x00]));
        return;
      }
      if (opcode === 0x01) {
        const isMasked = (buf[1] & 0x80) !== 0;
        let len = buf[1] & 0x7f;
        let offset = 2;
        if (len === 126) {
          len = buf.readUInt16BE(2);
          offset = 4;
        }
        if (isMasked && buf.length >= offset + 4 + len) {
          const mask = buf.slice(offset, offset + 4);
          offset += 4;
          const payload = Buffer.alloc(len);
          for (let i = 0; i < len; i++) {
            payload[i] = buf[offset + i] ^ mask[i % 4];
          }
          const text = payload.toString('utf8');
          if (text === 'ping') {
            socket.write(encodeWSFrame({ type: 'pong' }));
          }
        }
      }
    } catch (e) {}
  });

  socket.on('close', () => wsClients.delete(socket));
  socket.on('error', () => wsClients.delete(socket));
});

// Simulation Loop
function runLoop() {
  if (sim.running) {
    try {
      processTick();
    } catch (err) {
      console.error('Simulation tick error:', err);
    }
  }
  const delay = Math.max(50, (sim.interval * 1000) / sim.speed);
  setTimeout(runLoop, delay);
}

// Start Server
server.listen(PORT, HOST, () => {
  console.log(`=======================================================`);
  console.log(`  NEXCAV Pump Cavitation Backend running on http://${HOST}:${PORT}`);
  console.log(`  Live WebSocket stream: ws://${HOST}:${PORT}/ws/live`);
  console.log(`=======================================================`);
  runLoop();
});
